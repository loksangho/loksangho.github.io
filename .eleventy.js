require('dotenv').config();
const { documentToHtmlString } = require("@contentful/rich-text-html-renderer");
const trimWords = require('trim-words').default;

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy('css')
  eleventyConfig.addFilter("renderRichTextAsHtml", (value) =>
    documentToHtmlString(value)
  );
  eleventyConfig.addFilter("trimWords", (value) =>
    trimWords(value, 90, "...")
  );
}
