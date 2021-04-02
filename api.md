<a name="rewriter"></a>

## rewriter
Rewriter

**Kind**: global class  

* [rewriter](#rewriter)
    * [new rewriter([config])](#new_rewriter_new)
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

