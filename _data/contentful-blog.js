const contentful = require("contentful");

const client = contentful.createClient({
    // This is the space ID. A space is like a project folder in Contentful terms
    space: process.env.CTFL_SPACE,
    // This is the access token for this space. Normally you get both ID and the token in the Contentful web app
    accessToken: process.env.CTFL_ACCESSTOKEN
});
// This API call will request an entry with the specified ID from the space defined at the top, using a space-specific access token.

module.exports = async () => {
    return client.getEntries({ content_type: 'blogPost' }).then(function(response) {

            const blogPost = response.items
                .map(function(blogPost) {
                    return blogPost.fields;
                });
            return blogPost;
        })

        .catch(console.error);
};
