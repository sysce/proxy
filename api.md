<a name="rewriter"></a>

## rewriter
**Kind**: global class  

* [rewriter](#rewriter)
    * [new rewriter([config])](#new_rewriter_new)
    * [.url(value, meta, [options])](#rewriter+url) ⇒ <code>String</code>
    * [.unurl(value, meta, [options])](#rewriter+unurl) ⇒ <code>String</code>
    * [.js(value, meta, [options])](#rewriter+js) ⇒ <code>String</code>
    * [.css(value, meta, [options])](#rewriter+css) ⇒ <code>String</code>
    * [.decode_source(value, meta, [options])](#rewriter+decode_source) ⇒ <code>String</code>
    * [.html(value, meta, [options])](#rewriter+html) ⇒ <code>String</code>
    * [.unhtml(value, meta, [options])](#rewriter+unhtml) ⇒ <code>String</code>
    * [.decode_blob(Blob)](#rewriter+decode_blob) ⇒ <code>String</code>
    * [.decode_params(URL)](#rewriter+decode_params) ⇒ <code>URLSearchParams</code>
    * [.valid_url(URL, [Base])](#rewriter+valid_url) ⇒ <code>Undefined</code> \| <code>URL</code>

<a name="new_rewriter_new"></a>

### new rewriter([config])

| Param | Type | Description |
| --- | --- | --- |
| [config] | <code>Object</code> |  |
| [config.codec] | <code>Object</code> \| <code>String</code> | Codec to use for processing URLs, can be plain, xor, base64 |
| [config.title] | <code>String</code> | Page title to override with |
| [config.prefix] | <code>String</code> | URL prefix |
| [config.server] | <code>Object</code> | Nodehttp server to listen on |
| [config.interface] | <code>String</code> | Request networking interface |
| [config.http_agent] | <code>Object</code> | Http agent when requesting |
| [config.https_agent] | <code>Object</code> | Https agent when requesting |
| [config.timeout] | <code>Number</code> | Maximum outgoing request time |
| [config.ws] | <code>Boolean</code> | Websocket support |

**Example**  
```js
var server - new(require('nodehttp')).server({		port: 6080,	}),	rewriter = new(require('sys-proxy'))({		prefix: '/proxy',		server: server,	});server.post('/gateway', (req, res) => res.redirect(rewriter.url(req.body.url, { base: 'about:null', origin: req.url.origin })));
```
<a name="rewriter+url"></a>

### rewriter.url(value, meta, [options]) ⇒ <code>String</code>
Processes a given URL and routes it to the proxy

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - Processed URL  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | Input URL |
| meta | <code>Object</code> | Metadata (location, etc) |
| meta.base | <code>String</code> | Base when creating a url that is not proxied eg about:null, https://www.google.com |
| meta.origin | <code>String</code> | Proxy server origin eg https://localhost:7080 |
| [options] | <code>Object</code> |  |
| [options.ws] | <code>Boolean</code> | If the URL should route to the websocket proxy |
| [options.route] | <code>String</code> | The proxy route the URL should resolve to eg js, html, css, manifest |

<a name="rewriter+unurl"></a>

### rewriter.unurl(value, meta, [options]) ⇒ <code>String</code>
Undos rewriting

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - Raw URL  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | Input URL |
| meta | <code>Object</code> | Metadata (location, etc) |
| meta.base | <code>String</code> | Base when creating a url that is not proxied eg about:null, https://www.google.com |
| meta.origin | <code>String</code> | Proxy server origin eg https://localhost:7080 |
| [options] | <code>Object</code> |  |

<a name="rewriter+js"></a>

### rewriter.js(value, meta, [options]) ⇒ <code>String</code>
Rewrites JS

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - JS  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | Input JS |
| meta | <code>Object</code> | Metadata (location, etc) |
| meta.base | <code>String</code> | Base when creating a url that is not proxied eg about:null, https://www.google.com |
| meta.origin | <code>String</code> | Proxy server origin eg https://localhost:7080 |
| [options] | <code>Object</code> |  |
| [options.inline] | <code>Object</code> | If the JS comes from an attribute or <script> tag |

<a name="rewriter+css"></a>

### rewriter.css(value, meta, [options]) ⇒ <code>String</code>
Rewrites CSS

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - CSS  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | Input CSS |
| meta | <code>Object</code> | Metadata (location, etc) |
| meta.base | <code>String</code> | Base when creating a url that is not proxied eg about:null, https://www.google.com |
| meta.origin | <code>String</code> | Proxy server origin eg https://localhost:7080 |
| [options] | <code>Object</code> |  |
| [options.inline] | <code>Object</code> | If the CSS comes from an attribute or <style> tag |

<a name="rewriter+decode_source"></a>

### rewriter.decode\_source(value, meta, [options]) ⇒ <code>String</code>
Undos rewriting

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - Raw code  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | Input JS/CSS |
| meta | <code>Object</code> | Metadata (location, etc) |
| meta.base | <code>String</code> | Base when creating a url that is not proxied eg about:null, https://www.google.com |
| meta.origin | <code>String</code> | Proxy server origin eg https://localhost:7080 |
| [options] | <code>Object</code> |  |

<a name="rewriter+html"></a>

### rewriter.html(value, meta, [options]) ⇒ <code>String</code>
Rewrites HTML

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - Processed URL  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | Input HTML |
| meta | <code>Object</code> | Metadata (location, etc) |
| meta.base | <code>String</code> | Base when creating a url that is not proxied eg about:null, https://www.google.com |
| meta.origin | <code>String</code> | Proxy server origin eg https://localhost:7080 |
| [options] | <code>Object</code> |  |
| [options.snippet] | <code>Boolean</code> | Determines if code should be injected |

<a name="rewriter+unhtml"></a>

### rewriter.unhtml(value, meta, [options]) ⇒ <code>String</code>
Undos HTML rewriting

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - Raw HTML  

| Param | Type | Description |
| --- | --- | --- |
| value | <code>String</code> | Input HTML |
| meta | <code>Object</code> | Metadata (location, etc) |
| meta.base | <code>String</code> | Base when creating a url that is not proxied eg about:null, https://www.google.com |
| meta.origin | <code>String</code> | Proxy server origin eg https://localhost:7080 |
| [options] | <code>Object</code> |  |

<a name="rewriter+decode_blob"></a>

### rewriter.decode\_blob(Blob) ⇒ <code>String</code>
Decodes blob data

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>String</code> - Result  

| Param | Type | Description |
| --- | --- | --- |
| Blob | <code>Array</code> | data |

<a name="rewriter+decode_params"></a>

### rewriter.decode\_params(URL) ⇒ <code>URLSearchParams</code>
Decode params of URL, takes the prefix and then decodes a querystring

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  

| Param | Type | Description |
| --- | --- | --- |
| URL | <code>URL</code> \| <code>String</code> | to parse |

<a name="rewriter+valid_url"></a>

### rewriter.valid\_url(URL, [Base]) ⇒ <code>Undefined</code> \| <code>URL</code>
Validates a URL

**Kind**: instance method of [<code>rewriter</code>](#rewriter)  
**Returns**: <code>Undefined</code> \| <code>URL</code> - Result, is undefined if an error occured  

| Param | Type | Description |
| --- | --- | --- |
| URL | <code>URL</code> \| <code>String</code> | to parse |
| [Base] | <code>URL</code> \| <code>String</code> |  |

