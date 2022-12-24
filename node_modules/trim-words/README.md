# trim-words

[![NPM version][npm-image]][npm-url] [![Downloads][downloads-image]][npm-url] [![Build Status][travis-image]][travis-url] [![AppVeyor Build Status][appveyor-image]][appveyor-url] [![Dependency Status][dependency-image]][dependency-url]

Trims text to a certain number of words.

## Install

Via `npm`
```bash
npm install trim-words
```

Via Yarn
```bash
yarn add trim-words
```

## Usage

## With CommonJS

```javascript
var trimWords = require('trim-words').default;
```

## With React

```javascript
import trimWords from 'trim-words';
```

## Example

### Trims text to a certain number of words in `Node.js`

```javascript
const trimWords = require('trim-words').default;

const text = `<h1>What is Geostatistics?</h1 > <script>var a = 1; b = 2;</script><style>p { color: red; }</style><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis tincidunt quam ut ligula ullamcorper interdum. Nulla malesuada purus tristique justo tristique, id posuere purus tristique. Pellentesque non magna ut libero elementum interdum vel vitae ante. Sed porta auctor urna eget venenatis. Mauris nec convallis metus. Sed at dui elit. Donec rhoncus justo neque, finibus commodo dui posuere ut. Maecenas in mi enim. Quisque maximus enim nunc.</p> <p>Donec eu ultricies ipsum. Fusce eget pellentesque urna. Vestibulum lacinia laoreet mi nec posuere. Duis vel elit elementum, scelerisque eros a, sodales eros. Praesent hendrerit neque velit, nec pretium ipsum finibus facilisis. Proin ultricies sem in sapien consectetur dictum.</p>`;

const trimmedText = trimWords(text, 60, '...');

console.log('Trimmed Text is: ', trimmedText);
```

### Trims text to a certain number of words in `React`

```javascript
import trimWords from 'trim-words';

const text = `<h1>What is Geostatistics?</h1 > <script>var a = 1; b = 2;</script><style>p { color: red; }</style><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis tincidunt quam ut ligula ullamcorper interdum. Nulla malesuada purus tristique justo tristique, id posuere purus tristique. Pellentesque non magna ut libero elementum interdum vel vitae ante. Sed porta auctor urna eget venenatis. Mauris nec convallis metus. Sed at dui elit. Donec rhoncus justo neque, finibus commodo dui posuere ut. Maecenas in mi enim. Quisque maximus enim nunc.</p> <p>Donec eu ultricies ipsum. Fusce eget pellentesque urna. Vestibulum lacinia laoreet mi nec posuere. Duis vel elit elementum, scelerisque eros a, sodales eros. Praesent hendrerit neque velit, nec pretium ipsum finibus facilisis. Proin ultricies sem in sapien consectetur dictum.</p>`;

const trimmedText = trimWords(text, 60, '...');

console.log('Trimmed Text is: ', trimmedText);
```

## Parameters

| Attributes |   Type  | Required |   Default  | Description                                       |
|------------|:-------:|:--------:|:----------:|---------------------------------------------------|
| text       |  String |    Yes   |            | Text to trim.                                     |
| numWords   | Integer |    No    |    `55`    | Number of words.                                  |
| more       |  String |    No    | `ahellip;` | What to append if the `text` needs to be trimmed. |

## Return

Trimmed text.

## Tested

This package is tested with the `Node.js` and `React` Application.

[npm-image]: https://img.shields.io/npm/v/trim-words.svg
[npm-url]: https://www.npmjs.com/package/trim-words
[downloads-image]: https://img.shields.io/npm/dm/trim-words.svg

[travis-image]: https://img.shields.io/travis/com/samiahmedsiddiqui/trim-words.svg?label=travis-ci
[travis-url]: https://travis-ci.com/samiahmedsiddiqui/trim-words

[appveyor-url]: https://ci.appveyor.com/project/samiahmedsiddiqui/trim-words
[appveyor-image]: https://img.shields.io/appveyor/ci/samiahmedsiddiqui/trim-words.svg?label=appveyor

[dependency-image]: https://img.shields.io/david/samiahmedsiddiqui/trim-words.svg
[dependency-url]: https://david-dm.org/samiahmedsiddiqui/trim-words
