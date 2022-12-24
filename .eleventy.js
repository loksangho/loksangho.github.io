require('dotenv').config();
const { documentToHtmlString } = require("@contentful/rich-text-html-renderer");


module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy('css')
  eleventyConfig.addFilter("renderRichTextAsHtml", (value) =>
    documentToHtmlString(value)
  );
}
