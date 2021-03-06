'use strict';

var Promise = require('bluebird');
var path = require('path');
var logger = require('log4js').getLogger('paths-handler'); //jshint unused:false
var JuttleBundler = require('./bundler');
var fse = Promise.promisifyAll(require('fs-extra'));
var errors = require('./errors');

var root_dir = '';

function init(config) {
    root_dir = config.root;
}

function get_path(req, res, next) {
    var respath = req.params[0];
    logger.debug('getting-path', respath);

    var bundler = new JuttleBundler({root_dir: root_dir});

    return bundler.bundle(respath)
    .then(function(bundle) {
        res.status(200).send(bundle);
    })
    .catch(function(err) {
        // Pass along the error so it will be picked up by
        // default_error_handler.
        next(err);
    });
}


function get_dir(req, res, next) {
    var directories = [], juttles = [], relative_path, abs_path;

    Promise.try(function() {
        relative_path = req.query.path || '';
        relative_path = relative_path[0] === '/' ? relative_path.substring(1) : relative_path;
        relative_path = path.normalize(relative_path);

        // do not allow '..' unless its at end
        if (/\.\.(?!$)/.test(relative_path)) {
            throw errors.invalidPathError(req.query.path);
        }

        abs_path = path.join(root_dir, relative_path);

        logger.debug('get_dir request', req.query.path, 'resolved', abs_path);

        if (abs_path.indexOf(root_dir) !== 0) {
            throw errors.directoryAccessError(req.query.path);
        }

        return fse.readdirAsync(abs_path);
    })
    .then(function(paths) {
        return Promise.each(paths, function(file_path) {
            return fse.statAsync(path.join(abs_path, file_path))
            .then(function(stat) {
                if (stat.isDirectory()) {
                    directories.push(file_path);
                } else if (path.extname(file_path) === '.juttle'){
                    juttles.push(file_path);
                }
            })
            .catch(function(err) {
                // Ignore ENOENT errors -- this can happen if the directory
                // contains a dangling symlink
                if (err.code === 'ENOENT') {
                    return;
                } else {
                    throw err;
                }
            });
        });
    })
    .then(function(dir_contents) {
        res.status(200).send({
            is_root: root_dir === abs_path,
            path: path.join('/', relative_path),
            directories: directories,
            juttles: juttles
        });
    })
    .catch(function(err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
            next(errors.directoryNotFoundError(relative_path));
        } else {
            next(err);
        }
    });
}

module.exports = {
    init: init,
    get_path: get_path,
    get_dir: get_dir
};
