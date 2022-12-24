require('dotenv').config();
const { documentToHtmlString } = require("@contentful/rich-text-html-renderer");
const { trimWords } = require('trim-words');

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy('css')
  eleventyConfig.addFilter("renderRichTextAsHtml", (value) =>
    documentToHtmlString(value)
  );
  eleventyConfig.addFilter("trimWords", (value) =>
    trimWords(value, 60, "...")
  );
}
