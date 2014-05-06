/**
 * deploy script helper
 * author : Newton
 **/
exports.init = function (grunt){
    var exports = {},
        linefeed = grunt.util.linefeed,
        path = require('path'),
        cmd = require('cmd-helper'),
        ast = cmd.ast,
        iduri = cmd.iduri,
        UglifyJS = require('uglify-js'),
        log = require('../../log').init(grunt),
        verbose = grunt.option('verbose'),
        RELPATH_RE = /^\.{1,2}[/\\]/;

    // normalize uri to linux format
    function normalize(uri){
        return path.normalize(uri).replace(/\\/g, '/');
    }

    // debug source
    function modify(code, parsers){
        var parsed = ast.modify(code, function (v){
            var ext = path.extname(v);

            return ext && parsers[ext] ?
                v.replace(new RegExp('\\' + ext + '$'), '-debug' + ext) :
                v + '-debug';
        });

        // return code
        return parsed.print_to_string({
            beautify: true,
            comments: true
        });
    }

    // exports modify api
    exports.modify = modify;

    // compressor code
    function minify(code){
        return UglifyJS.minify(code, {
            outSourceMap: '{{file}}',
            fromString: true,
            warnings: verbose
        });
    }

    // fix sourcemap
    function fixSourcemap(code, file){
        var mini = iduri.basename(file);
        var full = mini.replace(/\.js$/i, '-debug.js');
        return code.replace('"file":"{{file}}"', '"file":"' + mini + '"')
            .replace('"sources":["?"]', '"sources":["' + full + '"]');
    }

    // combine, not include the excludes file
    // default read file from fpath, but you can set from code string by set fromstr args
    function combine(fpath, options){
        var records, buffer = '',
            excludes = options.excludes;

        // reset records
        grunt.option('concat-records', {});

        records = grunt.option('concat-records');

        // deep combine helper
        function walk(fpath, options){
            var code, meta;

            // cache readed file, prevent an circle loop, optimize efficiency
            if (records[fpath]) return;

            records[fpath] = true;

            // file not existe
            if (!grunt.file.exists(fpath)) {
                log.warn('  Can not find module :'.red, fpath.grey, '!'.red);
                return;
            }

            // deps, excludes, records, code, meta      
            code = grunt.file.read(fpath);
            meta = ast.parseFirst(code);

            if (meta) {
                if (meta.id) {
                    // walk dependencies modules
                    meta.dependencies.forEach(function (id){
                        var file;

                        // relative require
                        if (RELPATH_RE.test(id)) {
                            id = iduri.absolute(meta.id, id);
                        }

                        file = iduri.normalize(iduri.appendext(id));

                        // deep combine
                        if (id !== meta.id
                            && excludes.indexOf(id) === -1
                            && /\.js$/i.test(file)) {
                            walk(normalize(path.join(options.librarys, options.root, file)), options);
                        }
                    });
                } else {
                    // module has no module id, it will not work, return it
                    log.warn('  Module :'.red, fpath.grey, 'has no module id !'.red);
                }
            }

            // push code to the first buffer
            buffer += code + linefeed;
        }

        // start deep combine
        walk(fpath, options);

        // return buffer
        return buffer;
    }

    // exports combine api
    exports.combine = combine;

    // exports js concat
    exports.jsConcat = function (file, options){
        var buffer = '',
            code, meta, bufferAst,
            excludes = options.excludes,
            fpath = file.src,
            dist = normalize(path.relative(path.join(options.librarys, options.root), file.src)),
            data = {
                minify: {
                    dist: dist
                },
                source: {
                    dist: dist.replace(/\.js$/i, '-debug.js')
                }
            };

        // reset records
        grunt.option('concat-records', {});

        // combine
        switch (options.include) {
            case '.':
                code = grunt.file.read(fpath);
                meta = ast.parseFirst(code);

                if (meta) {
                    if (meta.id) {
                        // include relative file
                        meta.dependencies.forEach(function (id){
                            var file, fpath;

                            if (RELPATH_RE.test(id)) {
                                id = iduri.absolute(meta.id, id);

                                if (excludes.indexOf(id) === -1 && id !== meta.id) {
                                    file = iduri.normalize(iduri.appendext(id));
                                    fpath = normalize(path.join(options.librarys, options.root, file));

                                    if (grunt.file.exists(fpath)) {
                                        buffer += grunt.file.read(fpath) + linefeed;
                                    } else {
                                        log.warn('  Can not find module :'.red, fpath.grey, '!'.red);
                                    }
                                }
                            }
                        });
                    } else {
                        // module has no module id
                        log.warn('  Module :'.red, fpath.grey, 'has no module id !'.red);
                    }
                }
                buffer += code + linefeed;
                break;
            case '*':
                buffer += combine(fpath, options);
                break;
            default:
                buffer += grunt.file.read(fpath) + linefeed;
                break;
        }

        // create minify file
        log.info('  Compressoring script'.cyan);

        bufferAst = minify(buffer);
        data.minify.code = bufferAst.code + linefeed;
        log.ok('  Compressoring script success'.cyan);

        if (options.sourcemap) {
            // create source map
            log.info('  Creating script sourcemap'.cyan);

            data.minify.code += '/*' + linefeed + '//@ sourceMappingURL='
                + iduri.basename(data.minify.dist) + '.map' + linefeed + '*/';
            // sourcemap info
            data.sourcemap = {
                dist: data.minify.dist + '.map',
                code: fixSourcemap(bufferAst.map, data.minify.dist)
            };

            log.ok('  Create script sourcemap success'.cyan);
        }

        if (options.debugfile) {
            // create debug file
            log.info('  Creating debug script'.cyan);
            data.source.code = modify(buffer, options.parsers);
            log.ok('  Create debug script success'.cyan);
        }

        // return merger result
        return data;
    };

    return exports;
};
