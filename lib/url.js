'use strict';

module.exports = /*global.URL ? Object.assign(class extends global.URL {}, { searchParams: URLSearchParams }) :*/ (() => {
	var invalid = () => {}, relative = Object.create(null);
	relative.ftp = 21, relative.file = 0, relative.gopher = 70, relative.http = 80
		, relative.https = 443, relative.ws = 80, relative.wss = 443;
	var relativePathDotMapping = Object.create(null);

	function IDNAToASCII(h) {
		return '' == h && invalid.call(this), h.toLowerCase();
	}

	function percentEscape(c) {
		var unicode = c.charCodeAt(0);
		return unicode > 32 && unicode < 127 && -1 == [34, 35, 60, 62, 63, 96].indexOf(unicode) ? c : encodeURIComponent(c);
	}

	function percentEscapeQuery(c) {
		var unicode = c.charCodeAt(0);
		return unicode > 32 && unicode < 127 && -1 == [34, 35, 60, 62, 96].indexOf(unicode) ? c : encodeURIComponent(c);
	}
	relativePathDotMapping['%2e'] = '.';
	relativePathDotMapping['.%2e'] = relativePathDotMapping['%2e.'] = relativePathDotMapping['%2e%2e'] = '..';
	
	var EOF = void 0, ALPHA = /[a-zA-Z]/, ALPHANUMERIC = /[a-zA-Z0-9\+\-\.]/;

	function parse(input, stateOverride, base) {
		var state = stateOverride || 'scheme start', cursor = 0, buffer = '', seenAt = !1, seenBracket = !1;
		loop: for (;(input[cursor - 1] != EOF || 0 == cursor) && !this._isInvalid;) {
			var c = input[cursor];
			
			switch (state) {
				case 'scheme start':
					if (!c || !ALPHA.test(c)) {
						if (stateOverride) break loop;
						buffer = '', state = 'no scheme';
						continue;
					}
					buffer += c.toLowerCase(), state = 'scheme';

					break;
				case 'scheme':
					if (c && ALPHANUMERIC.test(c)) buffer += c.toLowerCase();
					else {
						if (':' != c) {
							if (stateOverride) {
								if (EOF == c) break loop;
								break loop;
							}
							buffer = '', cursor = 0, state = 'no scheme';
							continue;
						}
						if (this._scheme = buffer, buffer = '', stateOverride) break loop;
						void 0 !== relative[this._scheme] && (this._isRelative = !0), state = 'file' == this._scheme ? 'relative' : this._isRelative && base && base._scheme == this._scheme ? 'relative or authority' : this._isRelative ? 'authority first slash' : 'scheme data';
					}
					break;

				case 'scheme data':
					'?' == c ? (this._query = '?', state = 'query') : '#' == c ? (this._fragment = '#'
						, state = 'fragment') : EOF != c && '\t' != c && '\n' != c && '\r' != c && (this._schemeData += percentEscape(c));
					break;

				case 'no scheme':
					if (base && void 0 !== relative[base._scheme]) {
						state = 'relative';
						continue;
					}
					invalid.call(this);
					break;

				case 'relative or authority':
					if ('/' != c || '/' != input[cursor + 1]) {
						state = 'relative';
						continue;
					}
					state = 'authority ignore slashes';
					break;

				case 'relative':
					if (this._isRelative = !0, 'file' != this._scheme && (this._scheme = base._scheme)
						, EOF == c) {
						this._host = base._host, this._port = base._port, this._path = base._path.slice()
							, this._query = base._query, this._username = base._username, this._password = base._password;
						break loop;
					}
					if ('/' == c || '\\' == c) state = 'relative slash';
					else if ('?' == c) this._host = base._host
						, this._port = base._port, this._path = base._path.slice(), this._query = '?', this._username = base._username
						, this._password = base._password, state = 'query';
					else {
						if ('#' != c) {
							var nextC = input[cursor + 1]
								, nextNextC = input[cursor + 2];
							('file' != this._scheme || !ALPHA.test(c) || ':' != nextC && '|' != nextC || EOF != nextNextC && '/' != nextNextC && '\\' != nextNextC && '?' != nextNextC && '#' != nextNextC) && (this._host = base._host
								, this._port = base._port, this._username = base._username, this._password = base._password
								, this._path = base._path.slice(), this._path.pop()), state = 'relative path';
							continue;
						}
						this._host = base._host, this._port = base._port, this._path = base._path.slice()
							, this._query = base._query, this._fragment = '#', this._username = base._username
							, this._password = base._password, state = 'fragment';
					}
					break;

				case 'relative slash':
					if ('/' != c && '\\' != c) {
						'file' != this._scheme && (this._host = base._host, this._port = base._port, this._username = base._username
							, this._password = base._password), state = 'relative path';
						continue;
					}
					state = 'file' == this._scheme ? 'file host' : 'authority ignore slashes';
					break;

				case 'authority first slash':
					if ('/' != c) {
						state = 'authority ignore slashes';
						continue;
					}
					state = 'authority second slash';
					break;

				case 'authority second slash':
					if (state = 'authority ignore slashes', '/' != c) continue;
					break;

				case 'authority ignore slashes':
					if ('/' != c && '\\' != c) {
						state = 'authority';
						continue;
					}
					break;

				case 'authority':
					if ('@' == c) {
						seenAt && (buffer += '%40'), seenAt = !0;
						for (var i = 0; i < buffer.length; i++) {
							var cp = buffer[i];
							if ('\t' != cp && '\n' != cp && '\r' != cp)
								if (':' != cp || null !== this._password) {
									var tempC = percentEscape(cp);
									null !== this._password ? this._password += tempC : this._username += tempC;
								} else this._password = '';
						}
						buffer = '';
					} else {
						if (EOF == c || '/' == c || '\\' == c || '?' == c || '#' == c) {
							cursor -= buffer.length, buffer = '', state = 'host';
							continue;
						}
						buffer += c;
					}
					break;

				case 'file host':
					if (EOF == c || '/' == c || '\\' == c || '?' == c || '#' == c) {
						2 != buffer.length || !ALPHA.test(buffer[0]) || ':' != buffer[1] && '|' != buffer[1] ? (0 == buffer.length || (this._host = IDNAToASCII.call(this, buffer)
							, buffer = ''), state = 'relative path start') : state = 'relative path';
						continue;
					}
					'\t' == c || '\n' == c || '\r' == c || (buffer += c);
					break;

				case 'host':
				case 'hostname':
					if (':' != c || seenBracket) {
						if (EOF == c || '/' == c || '\\' == c || '?' == c || '#' == c) {
							if (this._host = IDNAToASCII.call(this, buffer), buffer = '', state = 'relative path start'
								, stateOverride) break loop;
							continue;
						}
						'\t' != c && '\n' != c && '\r' != c && ('[' == c ? seenBracket = !0 : ']' == c && (seenBracket = !1)
							, buffer += c);
					} else if (this._host = IDNAToASCII.call(this, buffer), buffer = '', state = 'port'
						, 'hostname' == stateOverride) break loop;
					break;

				case 'port':
					if (/[0-9]/.test(c)) buffer += c;
					else {
						if (EOF == c || '/' == c || '\\' == c || '?' == c || '#' == c || stateOverride) {
							if ('' != buffer) {
								var temp = parseInt(buffer, 10);
								temp != relative[this._scheme] && (this._port = temp + ''), buffer = '';
							}
							if (stateOverride) break loop;
							state = 'relative path start';
							continue;
						}
						'\t' == c || '\n' == c || '\r' == c || invalid.call(this);
					}
					break;

				case 'relative path start':
					if (state = 'relative path', '/' != c && '\\' != c) continue;
					break;

				case 'relative path':
					var tmp;
					if (EOF != c && '/' != c && '\\' != c && (stateOverride || '?' != c && '#' != c)) '\t' != c && '\n' != c && '\r' != c && (buffer += percentEscape(c));
					else(tmp = relativePathDotMapping[buffer.toLowerCase()]) && (buffer = tmp)
						, '..' == buffer ? (this._path.pop(), '/' != c && '\\' != c && this._path.push('')) : '.' == buffer && '/' != c && '\\' != c ? this._path.push('') : '.' != buffer && ('file' == this._scheme && 0 == this._path.length && 2 == buffer.length && ALPHA.test(buffer[0]) && '|' == buffer[1] && (buffer = buffer[0] + ':')
							, this._path.push(buffer)), buffer = '', '?' == c ? (this._query = '?', state = 'query') : '#' == c && (this._fragment = '#'
							, state = 'fragment');
					break;

				case 'query':
					stateOverride || '#' != c ? EOF != c && '\t' != c && '\n' != c && '\r' != c && (this._query += percentEscapeQuery(c)) : (this._fragment = '#'
						, state = 'fragment');
					break;

				case 'fragment':
					EOF != c && '\t' != c && '\n' != c && '\r' != c && (this._fragment += c);
			}
			cursor++;
		}
	}

	function clear() {
		this._scheme = '', this._schemeData = '', this._username = '', this._password = null
			, this._host = '', this._port = '', this._path = [], this._query = '', this._fragment = ''
			, this._isInvalid = !1, this._isRelative = !1;
	}
	
	class searchParams {
		static append(t, r, n) {
			// t = URLSearchParams instance
			var e = 'string' == typeof n ? n : null != n && 'function' == typeof n.toString ? n.toString() : JSON.stringify(n);
			Object.prototype.hasOwnProperty.call(t, r) ? t[r].push(e) : t[r] = [e];
		}
		static process(t) {
			var r = {};
			if ('object' == typeof t)
				if (Array.isArray(t))
					for (var n = 0; n < t.length; n++) {
						var e = t[n];
						if (!Array.isArray(e) || 2 !== e.length) throw new TypeError('Failed to construct \'URLSearchParams\': Sequence initializer must only contain pair elements');
						this.append(r, e[0], e[1]);
					} else
						for (var o in t) t.hasOwnProperty(o) && this.append(r, o, t[o]);
				else {
					0 === t.indexOf('?') && (t = t.slice(1));
					for (var i = t.split('&'), a = 0; a < i.length; a++) {
						var s = i[a]
							, c = s.indexOf('='); -
						1 < c ? this.append(r, decodeURIComponent(s.slice(0, c)), decodeURIComponent(s.slice(c + 1))) : s && this.append(r, decodeURIComponent(s), '');
					}
				}
			return r;
		}
		constructor(t) {
			((t = t || '') instanceof this.constructor) && (t = t.toString())
			, this.__URLSearchParams__ = this.constructor.process(t);
		}
		append(t, r) {
			this.constructor.append(this.__URLSearchParams__, t, r);
		}
		delete(t) {
			delete this.__URLSearchParams__[t];
		}
		get(t) {
			var r = this.__URLSearchParams__;
			return this.has(t) ? r[t][0] : null;
		}
		getAll(t) {
			var r = this.__URLSearchParams__;
			return this.has(t) ? r[t].slice(0) : [];
		}
		has(t) {
			return Object.prototype.hasOwnProperty.call(this.__URLSearchParams__, t);
		}
		set(t, r) {
			this.__URLSearchParams__[t] = ['' + r];
		}
		toString() {
			var t, r, n, o, i = this.__URLSearchParams__
				, a = [];
			for (r in i)
				for (n = encodeURIComponent(r), t = 0, o = i[r]; t < o.length; t++) a.push(n + '=' + encodeURIComponent(o[t]));
			return a.join('&');
		}
		forEach() {
			var n = this.constructor.process(this.toString());
			Object.getOwnPropertyNames(n).forEach((function(e) {
				n[e].forEach((function(n) {
					t.call(r, n, e, this);
				}), this);
			}), this);
		}
		sort() {
			var t, r, n, e = this.constructor.process(this.toString())
				, o = [];
			for (t in e) o.push(t);
			for (o.sort(), r = 0; r < o.length; r++) this.delete(o[r]);
			for (r = 0; r < o.length; r++) {
				var i = o[r]
					, a = e[i];
				for (n = 0; n < a.length; n++) this.append(i, a[n]);
			}
		}
		keys() {
			var t = [];
			this.forEach((function(r, n) {
				t.push(n);
			}));
			
			return global.Symbol.iterator(t);
		}
		values() {
			var t = [];
			this.forEach((function(r) {
				t.push(r);
			}));
			
			return global.Symbol.iterator(t);
		}
		entries() {
			var t = [];
			
			this.forEach((function(r, n) {
				t.push([n, r]);
			}));
			
			return global.Symbol.iterator(t);
		}
		[global.Symbol.iterator]() {
			return this.entries();
		}
	};
	
	class jURL {
		constructor(url, base) {
			void 0 === base || base instanceof jURL || (base = new jURL(String(base))), url = String(url)
				, this._url = url, clear.call(this);
			var input = url.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');
			parse.call(this, input, null, base);
		}
		toString() {
			return this.href;
		}
		get href() {
			if (this._isInvalid) return this._url;
			var authority = '';
			return '' == this._username && null == this._password || (authority = this._username + (null != this._password ? ':' + this._password : '') + '@')
				, this.protocol + (this._isRelative ? '//' + authority + this.host : '') + this.pathname + this._query + this._fragment;
		}
		set href(href) {
			clear.call(this), parse.call(this, href);
		}
		get protocol() {
			return this._scheme + ':';
		}
		set protocol(protocol) {
			this._isInvalid || parse.call(this, protocol + ':', 'scheme start');
		}
		get host() {
			return this._isInvalid ? '' : this._port ? this._host + ':' + this._port : this._host;
		}
		set host(host) {
			!this._isInvalid && this._isRelative && parse.call(this, host, 'host');
		}
		get hostname() {
			return this._host;
		}
		set hostname(hostname) {
			!this._isInvalid && this._isRelative && parse.call(this, hostname, 'hostname');
		}
		get port() {
			return this._port;
		}
		set port(port) {
			!this._isInvalid && this._isRelative && parse.call(this, port, 'port');
		}
		get pathname() {
			return this._isInvalid ? '' : this._isRelative ? '/' + this._path.join('/') : this._schemeData;
		}
		set pathname(pathname) {
			!this._isInvalid && this._isRelative && (this._path = [], parse.call(this, pathname, 'relative path start'));
		}
		get search() {
			return this._isInvalid || !this._query || '?' == this._query ? '' : this._query;
		}
		set search(search) {
			!this._isInvalid && this._isRelative && (this._query = '?', '?' == search[0] && (search = search.slice(1))
				, parse.call(this, search, 'query'));
		}
		get hash() {
			return this._isInvalid || !this._fragment || '#' == this._fragment ? '' : this._fragment;
		}
		set hash(hash) {
			this._isInvalid || (this._fragment = '#', '#' == hash[0] && (hash = hash.slice(1))
				, parse.call(this, hash, 'fragment'));
		}
		get origin() {
			var host;
			if (this._isInvalid || !this._scheme) return '';
			switch (this._scheme) {
				case 'data':
				case 'file':
				case 'javascript':
				case 'mailto':
					return 'null';
			}
			return (host = this.host) ? this._scheme + '://' + host : '';
		}
		get searchParams() {
			var params = new jURL.searchParams(this.search)
				, oset = params.set;
			return params.set = (key, val) => {
				oset(key, val), this.query = params.toString();
			}, params;
		}
		static searchParams = searchParams;
	}

	return jURL;
})();