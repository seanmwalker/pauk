const url = require('url');
htmlparser = require('htmlparser');

const fetchQueue = [];
let activeFetches = 0;

function fetchWithConcurrency(url, options, maxConcurrency) {
	return new Promise((resolve, reject) => {
		const task = () => {
			activeFetches++;
			fetch(url, options)
				.then(res => resolve(res))
				.catch(err => reject(err))
				.finally(() => {
					activeFetches--;
					if (fetchQueue.length > 0) {
						const next = fetchQueue.shift();
						next();
					}
				});
		};
		if (activeFetches < maxConcurrency) {
			task();
		} else {
			fetchQueue.push(task);
		}
	});
}

function Pauk(cnf) {
	this.config = Object.assign({
		// if true, www.example.com will resolve to example.com
		www: true,
		// maximum number of total requests
		maxRequests: 5,
		ignoreQuery: true
	}, cnf || {});

	this.host = '';
	// collection with crawled URIs as keys; values are objects with properties:
	// assets - object with images, css and scripts arrays, webpage static assets
	// parents - array of URIs that link to this URI
	// links - array of URIs that this URI links to
	// external - array of external links
	// protocol - protocol of this URI
	// error(optional) - message in case that URI is wrong
	this.cache = {};
	// total number of requests
	this.total = 0;
	// finished requests
	this.finished = 0;
	// public main method
	// uri - URI to crawl
	// parent - uri of the page that links to this uri
	this.crawl = function (uri, parent) {
		let pUri;
		try {
			pUri = this.parseUri(uri);
		} catch (e) {
			this.cache[uri] = {
				error: "Wrong URI, " + uri
			};
			if (this.total === this.finished) this.onFinish(this.cache);
			return;
		}
		if (pUri.key) {
			if (!this.cache[pUri.key]) {
				this.cache[pUri.key] = {
					protocol: pUri.protocol,
					parents: []
				};
				this.getUrl(pUri.key);
			}
			if (parent && this.cache[pUri.key].parents.indexOf(parent) === -1) this.cache[pUri.key].parents.push(parent);
		} else {
			this.cache[uri] = {
				error: "Wrong URI, " + uri
			};
			if (this.total === this.finished) this.onFinish(this.cache);
		}
	};

	this.urlParseCompat = function (input, parseQueryString = false, slashesDenoteHost = false, base) {
		let urlObj;
		let isRelative = false;
		let baseToUse = base || 'http://localhost';

		// Try to parse as absolute; if fails, treat as relative
		try {
			urlObj = new URL(input);
		} catch {
			urlObj = new URL(input, baseToUse);
			isRelative = true;
		}

		// Mimic legacy url.parse output
		const result = {
			href: urlObj.href,
			protocol: urlObj.protocol,
			slashes: urlObj.href.startsWith('//') || urlObj.href.startsWith('http://') || urlObj.href.startsWith('https://'),
			auth: urlObj.username ? (urlObj.username + (urlObj.password ? ':' + urlObj.password : '')) : null,
			host: urlObj.host,
			port: urlObj.port || null,
			hostname: urlObj.hostname,
			hash: urlObj.hash,
			search: urlObj.search,
			query: parseQueryString ? Object.fromEntries(urlObj.searchParams.entries()) : (urlObj.search ? urlObj.search.slice(1) : null),
			pathname: urlObj.pathname,
			path: urlObj.pathname + (urlObj.search || ''),
			href: urlObj.href,
		};

		return result;
	};

	// 	// Parameters:
	// returns parsed URL object and if it is valid:
	// - adds property 'key' to be used as key for cache
	// - adds property 'external' if the host of the key is not the same as host of the first URI
	// Parameters:
	// uri - absolute or relative path
	// protocol(optional) - if uri is realtive path, use protocol, default: 'http:'
	this.parseUri = function (uri, protocol) {
		var p = url.parse(uri);
		if (p.host === null) {
			if (!this.host) throw Error("First URI must have host part");
			if (typeof p.path !== "string") return p;

			p = url.parse(url.resolve((protocol || "http:") + "//" + this.host, p.path));
		} else {
			if (this.config.www) {
			var sp = p.host.split(".");
			if (sp.length === 3 && sp[0] === "www") {
				sp.shift();
				p.host = sp.join(".");
			}
			}
			// set host that we crawl or throw error if URI host is different
			if (!this.host) this.host = p.host;
			if (typeof p.path !== "string") return p;
		}	
		if (this.host !== p.host) p.external = true;
		p.key = this.config.ignoreQuery? url.resolve(p.protocol + "//" + this.host, p.pathname) : p.href;

		return p;
	};

	this.getUrl = function (key) {
		var t = this;
		this.total++;
		fetchWithConcurrency(key, {}, this.config.maxRequests)
			.then(async (response) => {
				const body = await response.text();
				t.finished++;
				t.onResponse(null, key, response.status, body);
			})
			.catch((err) => {
				t.finished++;
				t.onResponse(err, key, 0, null);
			});
	};

	this.onResponse = function (err, key, statusCode, body) {
		var c = this.cache[key];
		if (!c) {
			this.cache[key] = { error: "No cache entry for key: " + key };
			return;
		}
		if (err) {
			c.error = "Request failed, URI: " + key + ", " + err;
		} else if (statusCode === 200) {
			Object.assign(c, {
				assets: {
					images: [],
					scripts: [],
					css: [],
					other: []
				},
				links: [],
				external: []
			});
			this.parser(body, key);
			for (var i = 0; i < c.links.length; i++) {
				// crawl either when maxRequests number is not reached or when page is already cached, to add parent link
				if (this.total < this.config.maxRequests || this.cache[c.links[i]]) this.crawl(c.links[i], key);
			}
		} else {
			c.error = "Status Code " + statusCode;
		}
		if (this.total === this.finished) this.onFinish(this.cache);
	};

	this.parser = function (s, key) {
		var t = this;
		if (!this.cache[key]) this.cache[key] = { assets: { images: [], scripts: [], css: [], other: [] }, links: [], external: [] };
		var handler = new htmlparser.DefaultHandler(function (err, dom) {
			t.onParser(err, key, dom);
		}, { verbose: false, ignoreWhitespace: true }),
			parser = new htmlparser.Parser(handler);
		parser.parseComplete(s);
	};

	this.onParser = function (err, key, dom) {
		var o = this.cache[key];
		if (err) {
			o.error = "htmlparser failed, URI: " + key + ", " + err;
		} else {
			this.parseDom(dom, o);
		}
	};

	// main recursive method for parsing dom object returned by htmlparser
	this.parseDom = function (dom, o) {
		if (!o || !o.assets || !o.links || !o.external) return;
		dom.forEach((v) => {
			if (v.attribs) {
				if (v.attribs.src) {
					if (v.type === 'tag' && v.name === 'img') o.assets.images.push(v.attribs.src);
					else if (v.type === 'script') o.assets.scripts.push(v.attribs.src);
				} else if (v.attribs.href) {
					if (v.name === 'a') {
						var p = this.parseUri(v.attribs.href, o.protocol);

						if (p.key) {
							if (p.external && o.external.indexOf(p.href) === -1) o.external.push(p.href);
							else if (o.links.indexOf(p.key) === -1) o.links.push(p.key);
						} else if (o.assets.other.indexOf(p.href) === -1) {
							o.assets.other.push(p.href);
						}

					} else if (v.name === "link") o.assets.css.push(v.attribs.href);
				}
			}
			if (v.children) this.parseDom(v.children, o);
		}, this);
	};

	// public, called when crawling is finished
	this.onFinish = function (cache) {
	};

	return this;
};

module.exports = Pauk;

