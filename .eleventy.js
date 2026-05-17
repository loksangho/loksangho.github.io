require('dotenv').config();
const { documentToHtmlString } = require("@contentful/rich-text-html-renderer");
const { documentToPlainTextString } = require("@contentful/rich-text-plain-text-renderer");
const trimWords = require('trim-words').default;

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy('.well-known');
  eleventyConfig.addPassthroughCopy('css');
  eleventyConfig.addPassthroughCopy('assets');
  //eleventyConfig.addFilter("renderRichTextAsHtml", (value) =>
  //  documentToHtmlString(value)
  //);
  eleventyConfig.addFilter("renderRichTextAsHtml", function(content) {
    if (!content) return "";

    const options = {
      renderNode: {
        // This targets embedded images/assets in your rich text
        [BLOCKS.EMBEDDED_ASSET]: (node) => {
          const { file, title } = node.data.target.fields;
          // Return the actual HTML string for the image
          return `<img src="${file.url}" alt="${title}" loading="lazy" class="rich-text-image" />`;
        }
      }
    };

    return documentToHtmlString(content, options);
  });
  eleventyConfig.addFilter("renderRichTextAsPlainText", (value) =>
    documentToPlainTextString(value)
  );
  eleventyConfig.addFilter("trimWords", (value) =>
    trimWords(value, 90, "...")
  );
}
