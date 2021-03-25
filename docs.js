// create documentation
var fs = require('fs'),
	path = require('path'),
	doc = require('documentation'),
	file = path.join(__dirname, 'index.js'),
	ti = '```',
	t = '`';

console.log('starting..');

doc.build([ file ], { shallow: true }).then(data => doc.formats.md(data, { markdownToc: true })).then(docs => fs.promises.writeFile(path.join(__dirname, 'readme.md'), `# SystemYA Proxy

[![Download](https://img.shields.io/npm/dw/sys-proxy?style=for-the-badge)](https://www.npmjs.com/package/sys-proxy)
[![Deploy to Heroku](https://img.shields.io/badge/depoly-heroku-purple?style=for-the-badge)](https://heroku.com/deploy?template=https://github.com/sysce/proxy)
[![Deploy to Repl.it](https://img.shields.io/badge/depoly-repl.it-171d2d?style=for-the-badge)](https://repl.it/github/sysce/proxy)


## Quickstart:

${ti}
git clone https://github.com/sysce/proxy ./sys-proxy

node ./sys-proxy/demo
${ti}

## Installation:

${ti}
npm i sys-proxy
${ti}

### Demo:

See the [demo folder](demo/) for more usage examples

${ti}
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
${ti}

## API:

${docs}

### JS rewriting:

section under work

#### HTML rewriting:

A part of getting down full HTML rewriting is also making sure any dynamically made elements are rewritten.

[Getters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/get) and [setters](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/set) are used for properties on the ${t}Node.prototype${t} object for such as but not limited to:

- ${t}outerHTML${t}
- ${t}innerHTML${t}
- ${t}getAttribute${t}
- ${t}setAttribute${t}
- ${t}setAttributeNS${t}
- ${t}insertAdjacentHTML${t}
- ${t}nonce${t}
- ${t}integrity${t}
+ every attribute that is rewritten in the HTML side of things

Any property/function that inserts raw html code that is not rewritten is ran through the rewriters HTML handler.
Properties are handled by the rewriters HTML property handler (for consistency)

### CSS:

A basic regex to locate all ${t}url()${t} blocks is used and the rewriters URL handler is called with the value and meta for the page

### HTML:

A bundled version of [JSDOM](https://www.npmjs.com/package/jsdom) is used to achieve accuracy and consistency when rewriting and [DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser) in the browser.

Each property is iterated and in the rewriter a huge array containing information for determining the type of attribute being worked with is used ( this includes tag and name).

- If the type is a URL then the resulting value is determined by the rewriters URL handler
- If the type is JS then the resulting value is determined by the rewriters JS handler along with being wrapped for encoding
- If the type is CSS then the resulting value is determined by the rewriters CSS handler along

### Manifest:

A basic JSON.stringify checking if the key is ${t}src${t} or ${t}key${t} or ${t}start_url${t} and if it is then the rewriters URL handler is used to determine the result.

### Credits:

- https://github.com/DevExpress/testcafe-hammerhead for various modules such as acorn-hammerhead and esotope-hammerhead

`)).then(() => console.log('finished writing docs, find output at ' + __dirname));