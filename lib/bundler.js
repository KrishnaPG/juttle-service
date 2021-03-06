'use strict';

/* jshint node:true */
var path = require('path');
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var compiler = require('juttle/lib/compiler');
var URLResolver = require('juttle/lib/module-resolvers/url-resolver');
var FileResolver = require('juttle/lib/module-resolvers/file-resolver');
var resolver_utils = require('juttle/lib/module-resolvers/resolver-utils');
var JuttleServiceErrors = require('./errors');
var JuttleErrors = require('juttle/lib/errors');

class JuttleBundler {
    constructor(options) {
        var self = this;

        self.options = options || {};
        self.options.root_dir = self.options.root_dir || '/';
    }

    bundle(respath) {
        var self = this;

        var program;
        var modules = {};

        var filename = path.join(self.options.root_dir, respath);

        return fs.statAsync(filename)
            .then(function(stat) {
                if (!stat.isFile()) {
                    throw new Error('No such file');
                }
                // fs.access was first added in ~1.0 so skip this on v0 versions.
                if (process.version.split('.')[0] !== 'v0') {
                    return fs.accessAsync(filename, fs.R_OK);
                }
                return '';
            })
            .then(function() {
                return fs.readFileAsync(filename, 'utf8');
            })
            .then(function(read) {
                program = read;

                var file_resolver = new FileResolver();
                var url_resolver = new URLResolver();

                var resolver = resolver_utils.multiple([
                    file_resolver.resolve,
                    url_resolver.resolve
                ]);

                // Create a wrapper function around the resolver that saves
                // the results in a hash, so we don't have to do a second
                // fetch of the modules.
                function saving_resolver(module_path, module_name, importer_path) {
                    return resolver(module_path, module_name, importer_path)
                        .then(function(module) {
                            modules[module_path] = module.source;
                            return module;
                        });
                }

                // Parse the program simply to find the list of modules. Add
                // those modules to the program to create the bundle.
                var compile_options = {
                    stage: 'parse',
                    moduleResolver: saving_resolver,
                    filename: filename
                };
                return compiler.compile(program, compile_options);
            })
            .then(function() {
                return {bundle: {program: program, modules: modules}};
            }).catch(function(err) {
                if (err.message === 'No such file' ||
                    err.code === 'ENOENT') {
                    throw JuttleServiceErrors.fileNotFoundError(respath);
                } else if (err.code === 'EACCES') {
                    throw JuttleServiceErrors.fileAccessError(respath);
                } else if (err instanceof JuttleErrors.JuttleError) {
                    // In this case, we return the program and modules along
                    // with the error so the client can display the error in
                    // context.
                    throw JuttleServiceErrors.juttleError(err, {
                        program: program,
                        modules: modules
                    });
                } else {
                    throw err;
                }
            });
    }
}

module.exports = JuttleBundler;

