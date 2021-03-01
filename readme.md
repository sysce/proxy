# SystemYA Proxy

[![Download](https://img.shields.io/npm/dw/sys-proxy?style=for-the-badge)](https://www.npmjs.com/package/sys-proxy)
[![Deploy to Heroku](https://img.shields.io/badge/depoly-heroku-purple?style=for-the-badge)](https://heroku.com/deploy?template=https://github.com/sysce/proxy)
[![Deploy to Repl.it](https://img.shields.io/badge/depoly-repl.it-171d2d?style=for-the-badge)](https://repl.it/github/sysce/proxy)


## Quickstart:

```
git clone https://github.com/sysce/proxy ./sys-proxy

node ./sys-proxy/demo
```

## Installation:

```
npm i sys-proxy
```

## Significant sites tested ( as of 2/22/2021 ):

- krunker.io
- 1v1.lol
- justbuild.lol
- youtube.com ( only player )
- twitch.tv

### Demo:

See the [demo folder](demo/) for more usage examples

```
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

## API:

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

-   [index][1]
    -   [Parameters][2]
    -   [Properties][3]
    -   [url][4]
        -   [Parameters][5]
    -   [unurl][6]
        -   [Parameters][7]
    -   [js][8]
        -   [Parameters][9]
    -   [css][10]
        -   [Parameters][11]
    -   [uncss][12]
        -   [Parameters][13]
    -   [manifest][14]
        -   [Parameters][15]
    -   [html][16]
        -   [Parameters][17]
    -   [html_attr][18]
        -   [Parameters][19]
    -   [plain][20]
        -   [Parameters][21]
    -   [decode_blob][22]
        -   [Parameters][23]
    -   [attr_type][24]
        -   [Parameters][25]
    -   [headers_decode][26]
        -   [Parameters][27]
    -   [headers_encode][28]
        -   [Parameters][29]
    -   [cookie_encode][30]
        -   [Parameters][31]
    -   [cookie_decode][32]
        -   [Parameters][33]
    -   [decode_params][34]
        -   [Parameters][35]
    -   [decompress][36]
        -   [Parameters][37]
    -   [valid_url][38]
        -   [Parameters][39]
    -   [str_conf][40]
    -   [get_globals][41]
        -   [Parameters][42]
    -   [globals][43]
        -   [Parameters][44]
    -   [html_serial][45]
        -   [Parameters][46]
    -   [wrap][47]
        -   [Parameters][48]
    -   [checksum][49]
        -   [Parameters][50]

## index

Rewriter

### Parameters

-   `config` **[Object][51]** 
    -   `config.adblock` **[Boolean][52]?** Determines if the easylist.txt file should be used for checking URLs, this may decrease performance and increase resource usage
    -   `config.ws` **[Boolean][52]?** Determines if websocket support should be added
    -   `config.codec` **[Object][51]?** The codec to be used (rewriter.codec.plain, base64, xor)
    -   `config.prefix` **[Boolean][52]?** The prefix to run the proxy on
    -   `config.interface` **[Boolean][52]?** The network interface to request from
    -   `config.timeout` **[Boolean][52]?** The maximum request timeout time
    -   `config.title` **[Boolean][52]?** The title of the pages visited
    -   `config.http_agent` **[Object][51]?** Agent to be used for http&#x3A; / ws: requests
    -   `config.https_agent` **[Object][51]?** Agent to be used for https&#x3A; / wss: requests
-   `server` **[Object][51]** nodehttp/express server to run the proxy on, only on the serverside this is required

### Properties

-   `mime` **[Object][51]** Contains mime data for categorizing mimes
-   `attr` **[Object][51]** Contains attribute data for categorizing attributes and tags
-   `attr_ent` **[Object][51]** Object.entries called on attr property
-   `regex` **[Object][51]** Contains regexes used throughout the rewriter
-   `config` **[Object][51]** Where the config argument is stored
-   `URL` **[Object][51]** class extending URL with the `fullpath` property

### url

Prefixes a URL and encodes it

#### Parameters

-   `value`  
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter
    -   `data.type` **[Object][51]?** The type of URL this is (eg js, css, html), helps the rewriter determine how to handle the response
    -   `data.ws` **[Object][51]?** If the URL is a WebSocket
-   `null-null` **([String][53] \| [URL][54] \| [Request][55])** URL value

Returns **[String][53]** Proxied URL

### unurl

Attempts to decode a URL previously ran throw the URL handler

#### Parameters

-   `value`  
-   `data`   (optional, default `{}`)
-   `null-null` **[String][53]** URL value

Returns **[String][53]** Normal URL

### js

Scopes JS and adds in filler objects

#### Parameters

-   `value` **[String][53]** JS code
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter

Returns **[String][53]** 

### css

Rewrites CSS urls and selectors

#### Parameters

-   `value` **[String][53]** CSS code
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter

Returns **[String][53]** 

### uncss

Undos CSS rewriting

#### Parameters

-   `value` **[String][53]** CSS code
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter

Returns **[String][53]** 

### manifest

Rewrites manifest JSON data, needs the data object since the URL handler is called

#### Parameters

-   `value` **[String][53]** Manifest code
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter

Returns **[String][53]** 

### html

Parses and modifies HTML, needs the data object since the URL handler is called

#### Parameters

-   `value` **[String][53]** Manifest code
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.snippet` **[Boolean][52]?** If the HTML code is a snippet and if it shouldn't have the rewriter scripts added
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter

Returns **[String][53]** 

### html_attr

Validates and parses attributes, needs data since multiple handlers are called

#### Parameters

-   `node` **([Node][56] \| [Object][51])** Object containing at least getAttribute and setAttribute
-   `name` **[String][53]** Name of the attribute
-   `data` **[Object][51]** Standard object for all rewriter handlers
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter

### plain

Soon to add removing the servers IP, mainly for converting values to strings when handling

#### Parameters

-   `value` **([String][53] \| [Buffer][57])** Data to convert to a string
-   `data` **[Object][51]** Standard object for all rewriter handlers

### decode_blob

Decoding blobs

#### Parameters

-   `data`  
-   `Blob`  

Returns **[String][53]** 

### attr_type

Determines the attribute type using the `attr_ent` property

#### Parameters

-   `name` **[String][53]** Property name
-   `tag` **[String][53]?** Element tag

Returns **[String][53]** 

### headers_decode

Prepares headers to be sent to the client from a server

#### Parameters

-   `value`  
-   `data`   (optional, default `{}`)
-   `null-null` **[Object][51]** Headers

Returns **[Object][51]** 

### headers_encode

Prepares headers to be sent to the server from a client, calls URL handler so data object is needed

#### Parameters

-   `value`  
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.base` **[Object][51]?** Base URL, default is decoded version of the origin
    -   `data.route` **[Object][51]?** Adds to the query params if the result should be handled by the rewriter
    -   `data.type` **[Object][51]?** The type of URL this is (eg js, css, html), helps the rewriter determine how to handle the response
    -   `data.ws` **[Object][51]?** If the URL is a WebSocket
-   `null-null` **[Object][51]** Headers

Returns **[Object][51]** 

### cookie_encode

Prepares cookies to be sent to the client from a server, calls URL handler so

#### Parameters

-   `value` **[String][53]** Cookie header
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.url` **[Object][51]** Base URL (needed for hostname when adding suffix)

Returns **[Object][51]** 

### cookie_decode

Prepares cookies to be sent to the server from a client, calls URL handler so

#### Parameters

-   `value` **[String][53]** Cookie header
-   `data` **[Object][51]** Standard object for all rewriter handlers (optional, default `{}`)
    -   `data.origin` **[Object][51]** The page location or URL (eg localhost)
    -   `data.url` **[Object][51]** Base URL (needed for hostname when adding suffix)

Returns **[Object][51]** 

### decode_params

Decode params of URL, takes the prefix and then decodes a querystring

#### Parameters

-   `url`  
-   `URL` **([URL][54] \| [String][53])** to parse

Returns **URLSearchParams** 

### decompress

Decompresses response data

#### Parameters

-   `req`  
-   `res`  
-   `callback`  
-   `Client` **[Object][51]** request
-   `Request` **[Object][51]** response
-   `Callback` **[Function][58]** 

### valid_url

Validates a URL

#### Parameters

-   `args` **...any** 
-   `URL` **([URL][54] \| [String][53])** to parse
-   `Base` **([URL][54] \| [String][53])?** 

Returns **([Undefined][59] \| [URL][54])** Result, is undefined if an error occured

### str_conf

Returns a string version of the config\`

Returns **[Object][51]** 

### get_globals

Retrieves global data/creates if needed

#### Parameters

-   `global` **[Object][51]** 
-   `url` **[URL][54]** 

Returns **[Object][51]** 

### globals

Globals, called in the client to set any global data or get the proper fills object

#### Parameters

-   `url`  
-   `URL`  URL] - needed if page URL is not set globally

### html_serial

Serializes a JSDOM or DOMParser object

#### Parameters

-   `dom`  
-   `DOM` **[Document][60]** 

Returns **[String][53]** 

### wrap

Wraps a string

#### Parameters

-   `str`  
-   `String`  

Returns **[String][53]** 

### checksum

Runs a checksum on a string

#### Parameters

-   `r`  
-   `e`   (optional, default `5381`)
-   `t`   (optional, default `r.length`)
-   `String`  

Returns **[Number][61]** 

[1]: #index

[2]: #parameters

[3]: #properties

[4]: #url

[5]: #parameters-1

[6]: #unurl

[7]: #parameters-2

[8]: #js

[9]: #parameters-3

[10]: #css

[11]: #parameters-4

[12]: #uncss

[13]: #parameters-5

[14]: #manifest

[15]: #parameters-6

[16]: #html

[17]: #parameters-7

[18]: #html_attr

[19]: #parameters-8

[20]: #plain

[21]: #parameters-9

[22]: #decode_blob

[23]: #parameters-10

[24]: #attr_type

[25]: #parameters-11

[26]: #headers_decode

[27]: #parameters-12

[28]: #headers_encode

[29]: #parameters-13

[30]: #cookie_encode

[31]: #parameters-14

[32]: #cookie_decode

[33]: #parameters-15

[34]: #decode_params

[35]: #parameters-16

[36]: #decompress

[37]: #parameters-17

[38]: #valid_url

[39]: #parameters-18

[40]: #str_conf

[41]: #get_globals

[42]: #parameters-19

[43]: #globals

[44]: #parameters-20

[45]: #html_serial

[46]: #parameters-21

[47]: #wrap

[48]: #parameters-22

[49]: #checksum

[50]: #parameters-23

[51]: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object

[52]: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean

[53]: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String

[54]: https://developer.mozilla.org/docs/Web/API/URL/URL

[55]: https://developer.mozilla.org/Add-ons/SDK/High-Level_APIs/request

[56]: https://developer.mozilla.org/docs/Web/API/Node/nextSibling

[57]: https://nodejs.org/api/buffer.html

[58]: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function

[59]: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined

[60]: https://developer.mozilla.org/docs/Web/API/Document

[61]: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number


## How it works:

Recieve request => parse URL => send request to server => rewrite content => send to client

### JS:

To achieve accuracy when rewriting, this proxy uses "scoping". All js is wrapped in a [closure](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures) to override variables that otherwise are not possible normally (window, document)

[Proxies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) are used to change or extend any value to be in line with rewriting URLs

Any occurance of `this` is changed to call the global rw_this function with the `this` value, if the `this` value has a property indicating that the value has a proxied version, return the proxied version.

An example:

Call the rewriter and parse:
```
if(window.location == this.location)alert('Everything checks out!');
```

Expected result:

```
{let fills=<bundled code>,window=fills.this,document=fills.document;if(window.location == rw_this(this).location)alert('Everything checks out!');
//# sourceURL=anonymous:1
}
```

`this` in the input code is defined as `window`, the `window` has a proxied version that will also determine if any properties are proxied and give a result.

`this` => `fills.this`

`this.location` => `fills.url`

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

A basic regex to locate all `url()` blocks is used and the rewriters URL handler is called with the value and meta for the page

### HTML:

A bundled version of [JSDOM](https://www.npmjs.com/package/jsdom) is used to achieve accuracy and consistency when rewriting and [DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser) in the browser.

Each property is iterated and in the rewriter a huge array containing information for determining the type of attribute being worked with is used ( this includes tag and name).

- If the type is a URL then the resulting value is determined by the rewriters URL handler
- If the type is JS then the resulting value is determined by the rewriters JS handler along with being wrapped for encoding
- If the type is CSS then the resulting value is determined by the rewriters CSS handler along

### Manifest:

A basic JSON.stringify checking if the key is `src` or `key` or `start_url` and if it is then the rewriters URL handler is used to determine the result.
