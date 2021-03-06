var moment = require('moment-timezone');
var _ = require('underscore');
var Promise = require('promise');
var WarpError = require('../error');
var WarpSecurity = require('../security');
var middleware = require('./middleware');

module.exports = {
    find: function(req, res, next) {
        var options = {
            include: req.query.include? JSON.parse(req.query.include) : [],
            where: req.query.where? JSON.parse(req.query.where) : {},
            sort: req.query.order? JSON.parse(req.query.order) : [],
            limit: req.query.limit || 100,
            skip: req.query.skip || 0
        };
        
        var find = this._getUserModel().find(options);
            
        // View objects
        find.then(function(result)
        {
            res.json({ status: 200, message: 'Success', result: result });
        })
        .catch(function(err)
        {
            next(err);
        });
    },
    first: function(req, res, next) {
        var include = req.query.include? JSON.parse(req.query.include) : [];
        var id = parseInt(req.params.id);
        var first = this._getUserModel().first(id, include);
        
        // View object
        first.then(function(result) {        
            res.json({ status: 200, message: 'Success', result: result });
        })
        .catch(function(err) {
            next(err);
        });
    },
    create: function(req, res, next) {
        var fields = _.extend({}, req.body);
        
        if(!fields.username || !fields.password || !fields.email)
            throw new WarpError(WarpError.Code.InvalidCredentials, 'Missing credentials');
        
        var findUsername = this._getUserModel().find({ where: {
            'username': { 'eq': fields.username }
        }});
        var findEmail = this._getUserModel().find({ where: {
            'email': { 'eq' : fields.email }
        }})
                
        // Create object
        findUsername.then(function(result) {
            // Check if username is taken
            if(result.length > 0) throw new WarpError(WarpError.Code.UsernameTaken, 'Username already taken');
            return findEmail;
        }.bind(this))
        .then(function(result) {
            // Check if email is taken
            if(result.length > 0) throw new WarpError(WarpError.Code.EmailTaken, 'Email already taken');
            
            // Prepare user creation
            var create = this._getUserModel().create({ fields: fields }, { client: req.client, sdkVersion: req.sdkVersion, appVersion: req.appVersion });
            return create;
        }.bind(this))
        .then(function(result)
        {
            res.json({ status: 200, message: 'Success', result: result });    
        })
        .catch(function(err)
        {
            next(err);
        });
    },
    update: function(req, res, next) {
        var params = _.extend({}, req.body);
        var id = parseInt(req.params.id);
        var sessionToken = req.sessionToken;
        var masterKey = req.get('X-Warp-Master-Key');
        var query = new this.Query.View(this._getSessionModel().className);

        // Prepare conditional promise
        var conditionalPromise = Promise.resolve();
        
        // Check if master key is set
        if(masterKey !== this._config.security.masterKey)
        {
            conditionalPromise = conditionalPromise.then(function() 
            { 
                return query.where({ 
                    'session_token': { 'eq' : sessionToken }, 
                    'revoked_at': { 'gt': moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss') } 
                })
                .first();
            })
            .then(function(result) 
            {
                if(!result)
                    throw new WarpError(WarpError.Code.InvalidSessionToken, 'Session does not exist');
                if(id != result.user_id)
                    throw new WarpError(WarpError.Code.ForbiddenOperation, 'Users can only edit their own data');
            });
        }

        // Check session
        conditionalPromise.then(function()
        {
            // Update object, if valid    
            return this._getUserModel().update({ id: id, fields: params }, { client: req.client, sdkVersion: req.sdkVersion, appVersion: req.appVersion });
        }.bind(this))
        .then(function(result)
        {
            res.json({ status: 200, message: 'Success', result: result });
        })
        .catch(function(err)
        {
            next(err);
        });
    },
    destroy: function(req, res, next) {
        var id = parseInt(req.params.id);
        var sessionToken = req.sessionToken;
        var masterKey = req.get('X-Warp-Master-Key');
        var query = new this.Query.View(this._getSessionModel().className);
        
        // Prepare conditional promise
        var conditionalPromise = Promise.resolve();

        // Check if master key is set
        if(masterKey !== this._config.security.masterKey)
        {
            conditionalPromise = conditionalPromise.then(function() 
            { 
                return query.where({ 
                    'session_token': { 'eq' : sessionToken }, 
                    'revoked_at': { 'gt': moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss') } 
                })
                .first();
            })
            .then(function(result) 
            {
                if(!result)
                    throw new WarpError(WarpError.Code.InvalidSessionToken, 'Session does not exist');
                if(id != result.user_id)
                    throw new WarpError(WarpError.Code.ForbiddenOperation, 'Users can only destroy their own data');
            });
        }

        // Check session
        conditionalPromise.then(function()
        {
            // Destroy object, if valid    
            return this._getUserModel().destroy({ id: id }, { client: req.client, sdkVersion: req.sdkVersion, appVersion: req.appVersion });
        }.bind(this))
        .then(function(result)
        {
            res.json({ status: 200, message: 'Success', result: result });
        })
        .catch(function(err)
        {
            next(err);
        });
    },
    me: function(req, res, next) {
        var include = req.query.include? JSON.parse(req.query.include) : [];
        var sessionToken = req.sessionToken;
        var query = new this.Query.View(this._getSessionModel().className);
        
        query.where({ 'session_token': { 'eq' : sessionToken }, 'revoked_at': { 'gt': moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss') } })
        .first(function(result) 
        {
            if(!result)
                throw new WarpError(WarpError.Code.InvalidSessionToken, 'Session does not exist');
            
            var first = this._getUserModel().first(result.user_id, include);
            return first.then(function(user) {
                res.json({ status: 200, message: 'Success', result: user });
            });
        }.bind(this))
        .catch(function(err) 
        {
            next(err);
        });
    },
    changePassword: function(req, res, next) {
        var sessionToken = req.sessionToken;
        var oldPassword = req.body.old_password;
        var query = new this.Query.View(this._getSessionModel().className);

        query.where({ 'session_token': { 'eq' : sessionToken }, 'revoked_at': { 'gt': moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss') } })
        .first(function(result) 
        {
            if(!result)
                throw new WarpError(WarpError.Code.InvalidSessionToken, 'Session does not exist');
            
            // Prepare user query
            var userQuery = new this.Query.View(this._getUserModel().className);
            return userQuery.select({
                'id': 'id', 
                'password': 'password'
            })
            .where({ 'id': { 'eq': result.user_id } })
            .first(function(user) {
                if(!user)
                    throw new WarpError(WarpError.Code.InvalidSessionToken, 'User does not exist');

                if(user && WarpSecurity.validate(oldPassword, user.password))
                {
                    // Update password, if valid
                    return this._getUserModel().update({ id: user.id, fields: { password: req.body.new_password } }, { client: req.client, sdkVersion: req.sdkVersion, appVersion: req.appVersion });
                }
                else
                    throw new WarpError(WarpError.Code.InvalidCredentials, 'Invalid credentials');
            }.bind(this));
        }.bind(this))        
        .then(function() {
            res.json({ status: 200, message: 'Success' });
        })
        .catch(function(err) 
        {
            next(err);
        });
    },
    login: function(req, res, next) {
        var username = req.body.username;
        var email = req.body.email;
        var password = req.body.password.toString();
        var origin = req.get('X-Warp-Origin');
        
        var query = new this.Query.View(this._getUserModel().className);
        
        query.select({
            'id': 'id', 
            'password': 'password'
        });

        if(username)
        {
            query.where({
                'username': { 'eq' : username }
            });
        }
        else
        {
            query.where({
                'email': { 'eq': email }
            });
        }

        query.first(function(user) 
        {
            if(user && WarpSecurity.validate(password, user.password))
            {
                var fields = {
                    'user': {
                        type: 'Pointer',
                        className: this._getUserModel().className,
                        id: user.id
                    },
                    'origin': origin
                };
                
                return this._getSessionModel().create({ fields: fields });
            }
            else
            {
                throw new WarpError(WarpError.Code.InvalidCredentials, 'Invalid username/password');
            }
        }.bind(this))
        .then(function(result) {
            return this._getSessionModel().first(result.id);
        }.bind(this))
        .then(function(session) {
            res.json({ status: 200, message: 'Success', result: session });
        })
        .catch(function(err) 
        {
            next(err);
        });
    },
    logout: function(req, res, next) {
        var sessionToken = req.sessionToken;
        var query = new this.Query.View(this._getSessionModel().className);
        
        query.where({ 'session_token': { 'eq' : sessionToken }, 'revoked_at': { 'gt': moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss') } })
        .first(function(session) 
        {
            if(!session)
            {
                throw new WarpError(WarpError.Code.InvalidSessionToken, 'Session does not exist');
            }
            
            var action = new this.Query.Action(this._getSessionModel().className, session.id);
            
            return action.fields({ 'revoked_at': moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss') })
            .update(function(result) {
                res.json({ status: 200, message: 'Success', result: result });
            });
        }.bind(this))
        .catch(function(err) {
            next(err);
        });
    },
    readKeys: function(req, res, next) {
        var model = this._getUserModel();
        
        // Get model keys
        var keys = {
            viewable: model.keys.viewable,
            actionable: model.keys.actionable
        };

        // Check if pointers exist
        if(model.keys.pointers)
            keys['pointers'] = model.keys.pointers;

        // Return keys
        res.json({ status: 200, message: 'Success', result: keys});
    },
    apply: function(context, router) {
        var masterKeyRequired = middleware.requireMasterKey(context._config.security.masterKey);
        router.get('/users', this.find.bind(context));
        router.get('/users/me', this.me.bind(context));
        router.get('/users/keys', masterKeyRequired, this.readKeys.bind(context));
        router.get('/users/:id', this.first.bind(context));
        router.post('/users', this.create.bind(context));
        router.post('/users/change-password', this.changePassword.bind(context))
        router.put('/users/:id', this.update.bind(context));
        router.delete('/users/:id', this.destroy.bind(context));
        router.post('/login', this.login.bind(context));
        router.get('/logout', this.logout.bind(context));
        return router;
    }
};