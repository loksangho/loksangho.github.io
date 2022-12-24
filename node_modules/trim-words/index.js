"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const trim_php_1 = __importDefault(require("trim-php"));
function trimWords(text, numWords, more) {
    const sep = ' ';
    let wordsArray = [];
    if (!numWords) {
        numWords = 55;
    }
    if (!more) {
        more = '&hellip;';
    }
    text = text.replace(/<(script|style)([\S\s]*?)>([\S\s]*?)<\/(script|style)>/ig, '');
    text = text.replace(/(<([^>]+)>)/ig, '');
    text = new trim_php_1.default().trim(text);
    wordsArray = text.split(/[\n\r\t ]+/, numWords + 1);
    if (wordsArray.length > numWords) {
        wordsArray.pop();
        text = wordsArray.join(sep);
        text = text + more;
    }
    else {
        text = wordsArray.join(sep);
    }
    return text;
}
exports.default = trimWords;
