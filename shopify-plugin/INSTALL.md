# Archived Shopify Integration Notes

PakkOrder originally supported Shopify through two approaches:

1. **Shopify OAuth + `orders/create` webhooks** handled by the backend routes in `src/routes/shopify-app.js` and `src/routes/shopify-webhook.js`.
2. **Storefront/order-status snippets** used during earlier iterations of the product.

This repository is an archived portfolio snapshot, not an installable production Shopify app. The historical `pakkorder.com` deployment is no longer assumed to exist.

For local experimentation, configure your own `APP_URL`, `SHOPIFY_CLIENT_ID`, and `SHOPIFY_CLIENT_SECRET`, use a development Shopify store, and point any storefront snippet to your own backend URL. Never reuse historical PakkOrder credentials.

The included `snippet.liquid` is retained only as an example of the earlier storefront integration approach.
