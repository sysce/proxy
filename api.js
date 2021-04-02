var fs = require('fs'), path = require('path');

console.time('API')

require('jsdoc-to-markdown').render({ files: path.join(__dirname, 'index.js') }).then(data => fs.promises.writeFile(path.join(__dirname, 'api.md'), data)).then(() => console.timeEnd('API'));