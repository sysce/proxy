# SystemYA Proxy

| [![Download](https://img.shields.io/npm/dw/sys-proxy?style=for-the-badge)](https://www.npmjs.com/package/sys-proxy) | [![Deploy to Heroku](https://img.shields.io/badge/depoly-heroku-purple?style=for-the-badge)](https://heroku.com/deploy?template=https://github.com/sysce/proxy) | [![Deploy to Repl.it](https://img.shields.io/badge/depoly-repl.it-171d2d?style=for-the-badge)](https://repl.it/github/sysce/proxy) | [API](./api.md) |


## Quickstart:

```sh
git clone https://github.com/sysce/proxy ./sys-proxy

node ./sys-proxy/demo
```

## Installation:

```sh
npm i sys-proxy
```

### Demo:

See the [demo folder](demo/) for more usage examples

```js
var nodehttp = require('sys-nodehttp'),
	rewriter = require('sys-proxy'),
	server = new nodehttp.server({
		port: 7080,
		static: path.join(__dirname, 'public'),
	}),
	rw = new rewriter({
		prefix: '/service',
		codec: rewriter.codec.xor,
		server: server,
		title: 'Service',
	});

// [0000] server listening on http://localhost:7080/
```

### JS rewriting:

section under work

#### HTML rewriting:

A part of getting down full HTML rewriting is also making sure any dynamically made elements are rewritten.

[Getters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get) and [setters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/set) are used for properties on the `Node.prototype` object for such as but not limited to:

- `outerHTML`
- `innerHTML`
- `getAttribute`
- `setAttribute`
- `setAttributeNS`
- `insertAdjacentHTML`
- `nonce`
- `integrity`
+ every attribute that is rewritten in the HTML side of things

Any property/function that inserts raw html code that is not rewritten is ran through the rewriters HTML handler.
Properties are handled by the rewriters HTML property handler (for consistency)

### CSS:

[CSSTree](https://github.com/csstree/csstree) is used to parse and serialize CSS.

Each CSS rule is iterated, if the rule is a url then it will be iterated for strings and raw text then ran through the rewriters URL handler. If the rule is an import statement then the imported string will be ran through the rewriters URL handler.

### HTML:

[parse5](https://github.com/inikulin/parse5) is used to parse and serialize HTML.

All nodes are iterated along with their properties. If a criteria has been met to classify a property as a URL, the rewriters URL method will be applied, same goes for HTML, CSS, and JS.

### JS:

[Acorn](https://github.com/acornjs/acorn) is used to parse JS.
[Esotope](https://github.com/inikulin/esotope) is used to serialize JS.

todo: document

### Manifest:

JSON.stringify is used to lazily iterate the manifest, key names are checked and determined if they are a URL then ran through the rewriters URL handler.