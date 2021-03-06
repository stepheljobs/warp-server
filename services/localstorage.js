// References
var Promise = require('promise');
var moment = require('moment-timezone');
var _ = require('underscore');
var fs = require('fs');
var path = require('path');

// Prepare log header
function logHeader() {
    return '[Warp LocalStorage ' + moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss') + ']';
}

// Prepare class
var localstorage = function(path) {
    this.path = path || '';
};

// Instance methods
_.extend(localstorage.prototype, {
    _getKey: function(filename, next) {
        var now = moment().tz('UTC').format('YYYYMMDDHHmmss');
        var randomizer = (Math.random() * 1e32).toString(36);
        var dirname = path.dirname(filename);
        var baseFilename = now + '-' + randomizer  + '-' + path.basename(filename);
        next(path.join(dirname, baseFilename));
    },
    _getUrl: function(key) {
        return key;
    },
    setKeyFormat: function(keyFormat) {
        this._getKey = keyFormat;
        return this;
    },
    setUrlFormat: function(urlFormat) {
        this._getUrl = urlFormat;
        return this;
    },
    upload: function(filename, file, resolve, reject) {
        try
        {
            var path = this.path;
            return this._getKey(filename, function(key) {
                var url = this._getUrl(key);
                var filepath = path.join(path, key);
                fs.writeFileSync(filepath, file);
                return resolve({ key: key, url: url });
            }.bind(this));
        }
        catch(ex)
        {
            console.error(logHeader(), 'Could not save file to path', ex.message, ex.stack);
            var error = new Error('Could not save file to path');
            return reject(error);
        }
    },
    destroy: function(key) {
        return new Promise(function(resolve, reject) {
            try
            {
                var now = moment().tz('UTC');
                var filepath = path.join(this.path, key);
                fs.unlinkSync(filepath);
                resolve({ key: key, deleted_at: now.format() });
            }
            catch(ex)
            {                
                console.error(logHeader(), 'Could not destroy file', ex.message, ex.stack);
                var error = new Error('Could not destroy file');
                return reject(error);
            }
        }.bind(this));
    }
});

module.exports = localstorage;