require('dotenv').config();
const { documentToHtmlString } = require("@contentful/rich-text-html-renderer");
const { documentToPlainTextString } = require("@contentful/rich-text-plain-text-renderer");
const trimWords = require('trim-words').default;

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy('.well-known');
  eleventyConfig.addPassthroughCopy('css');
  eleventyConfig.addPassthroughCopy('assets');
  eleventyConfig.addFilter("renderRichTextAsHtml", (value) =>
    documentToHtmlString(value)
  );
  eleventyConfig.addFilter("renderRichTextAsPlainText", (value) =>
    documentToPlainTextString(value)
  );
  eleventyConfig.addFilter("trimWords", (value) =>
    trimWords(value, 90, "...")
  );
}
