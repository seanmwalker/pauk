const Pauk = require('./index');

describe('class Pauk', () => {
    let pauk;
    beforeEach(() => {
        pauk = new Pauk();
    });

    test('is instantiable', () => {
        expect(pauk).toBeInstanceOf(Pauk);
    });
    test('has expected public properties', () => {
        expect(pauk).toHaveProperty('config');
        expect(pauk).toHaveProperty('cache');
        expect(typeof pauk.crawl).toBe('function');
        expect(typeof pauk.onFinish).toBe('function');
    });
    describe('argument', () => {
        test('is object merged to config', () => {
            const args = {foo: 'woof'};
            const pauk2 = new Pauk(args);
            expect(pauk2.config).toHaveProperty('foo', args.foo);
        });
    });
    describe('parseUri method', () => {
        let parsed;
        test('exists', () => {
            expect(typeof pauk.parseUri).toBe('function');
        });
        test('throws error if called first time with relative uri', () => {
            let error;
            try {
                parsed = pauk.parseUri('some/path');
            } catch (e) {
                error = e;
            }
            expect(parsed).toBeUndefined();
            expect(error).toBeDefined();
        });
        test('sets host property of the instance on first valid call', () => {
            pauk.parseUri('http://www.runbanner.com');
            expect(pauk.host).toBe('runbanner.com');
        });
        test('properly detects external domain', () => {
            parsed = pauk.parseUri('http://www.google.com');
            expect(parsed.external).toBeDefined();
        });
        test('removes www from the key', () => {
            parsed = pauk.parseUri('http://www.runbanner.com/some/path');
            expect(parsed.host).toBe('runbanner.com');
        });
        test('removes search query from the key', () => {
            parsed = pauk.parseUri('http://www.runbanner.com/some/path?p=234&hello=world');
            expect(parsed.key).toBe('http://runbanner.com/some/path');
        });
        test('protocol argument applied to relative url', () => {
            parsed = pauk.parseUri('some/path?p=234&hello=world', 'ftp:');
            expect(parsed.protocol).toBe('ftp:');
        });
    });
    describe('crawl method', () => {
        let parse, get, uri;
        beforeEach(() => {
            parse = jest.spyOn(pauk, 'parseUri');
            get = jest.spyOn(pauk, 'getUrl').mockImplementation(() => {});
        });
        afterEach(() => {
            parse.mockRestore();
            get.mockRestore();
        });
        test('is calling parseUri and getUrl', () => {
            uri = 'test';
            pauk.crawl(uri);
            expect(parse).toHaveBeenCalledWith(uri);
            expect(get).toHaveBeenCalledWith(parse.mock.results[0].value.key);
        });
        test('sets error on wrong uri', () => {
            uri = 'htpp://test';
            pauk.crawl(uri);
            expect(pauk.cache[uri].error).toBeDefined();
        });
        test('is calling getUrl only if uri is not cached', () => {
            uri = 'http://runbanner.com/really/new/path';
            pauk.crawl(uri);
            expect(get).toHaveBeenCalledWith(uri);
            get.mockClear();
            uri = 'http://runbanner.com/really/new/path';
            pauk.crawl(uri);
            expect(get).not.toHaveBeenCalledWith(uri);
        });
        test("argument 'parent' is added to parents array", () => {
            uri = 'http://runbanner.com/test';
            pauk.crawl(uri, 'test');
            expect(pauk.cache[uri].parents).toContain('test');
        });
    });
    describe('onResponse method', () => {
        let parser, key = 'test';
        beforeAll(() => {
            pauk.cache = {};
            parser = jest.spyOn(pauk, 'parser').mockImplementation(() => {});
        });
        beforeEach(() => {
            pauk.cache[key] = {};
        });
        afterAll(() => {
            parser.mockRestore();
        });
        test('sets error on request error', () => {
            pauk.onResponse(new Error('some error'), key);
            expect(pauk.cache[key].error).toBeDefined();
        });
        test('sets error when status code not 200', () => {
            pauk.onResponse(null, key, 401);
            expect(pauk.cache[key].error).toBeDefined();
        });
        test('prepares cache on proper response', () => {
            pauk.onResponse(null, key, 200, '');
            expect(pauk.cache[key]).toHaveProperty('assets');
            expect(pauk.cache[key].assets).toHaveProperty('images');
            expect(pauk.cache[key].assets).toHaveProperty('scripts');
            expect(pauk.cache[key].assets).toHaveProperty('css');
            expect(pauk.cache[key].assets).toHaveProperty('other');
            expect(pauk.cache[key]).toHaveProperty('links');
            expect(pauk.cache[key]).toHaveProperty('external');
            expect(parser).toHaveBeenCalledTimes(1);
        });
    });
    describe('parser', () => {
        const key = 'test';
        let s;
        beforeAll(() => {
            pauk.cache = {};
        });
        beforeEach(() => {
            pauk.cache[key] = {
                assets: {
                    images: [],
                    scripts: [],
                    css: [],
                    other: []
                },
                links: [],
                external: []
            };
        });
        test('img tag', () => {
            s = '<img src="test.png" />';
            pauk.parser(s, key);
            expect(pauk.cache[key].assets.images).toContain('test.png');
        });
        test('script tag', () => {
            s = '<script src="test.js" />';
            pauk.parser(s, key);
            expect(pauk.cache[key].assets.scripts).toContain('test.js');
        });
        test('css tag', () => {
            s = '<link href="test.css" />';
            pauk.parser(s, key);
            expect(pauk.cache[key].assets.css).toContain('test.css');
        });
        test('mailto link', () => {
            s = '<a href="mailto:info@runbanner.com" />';
            pauk.parser(s, key);
            expect(pauk.cache[key].assets.other).toContain('mailto:info@runbanner.com');
        });
        test('external link', () => {
            s = '<a href="http://google.com/" />';
            pauk.parser(s, key);
            expect(pauk.cache[key].external).toContain('http://google.com/');
        });
        test('relative link', () => {
            s = '<a href="http://www.runbanner.com/" />';
            pauk.parser(s, key);
            s = '<a href="hello/path" />';
            pauk.parser(s, key);
            expect(pauk.cache[key].links).toContain('http://runbanner.com/hello/path');
        });
    });
});

