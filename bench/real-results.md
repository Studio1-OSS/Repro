# Repro on real sites

2026-10-23 · MiniMaxAI/MiniMax-M3.1-Flash · public test sites with bugs in their own code. Run with `pnpm bench:real`.

| Case | Site | Reporter's note | Report | Agent | Result |
| --- | --- | --- | --- | --- | --- |
| saucedemo-sort | saucedemo.com (problem_user) | Sorting products by price does nothing | Inventory sort dropdown resets to "Name (A to Z)" and price order is not applied | reproduced (2 steps) | ✓ |
| saucedemo-images | saucedemo.com (problem_user) | All the product pictures show the same dog | All product images on /inventory.html render the same dog photo instead of per-product images | reproduced (1 steps) | ✓ |
| saucedemo-add-to-cart | saucedemo.com (error_user) | Add to cart throws an error on some products | Add to cart for Sauce Labs Bolt T-Shirt fails with uncaught error "Failed to add item to the cart." on /inventory.html | reproduced (3 steps) | ✓ |
| the-internet-js-error | the-internet.herokuapp.com | This page throws an error as soon as it loads | Uncaught TypeError on load at /javascript_error: loadError reads 'xyz' of undefined | reproduced (2 steps) | ✓ |
| the-internet-broken-images | the-internet.herokuapp.com | Two of the images on this page are broken | Two images fail to load on /broken_images: /hjkl.jpg and /asdf.jpg | reproduced (1 steps) | ✓ |
| saucedemo-visual-layout | saucedemo.com (visual_user) | Product cards look misaligned | Product cards overflow the viewport on narrow screens and misalign the cart and sort controls at 1280px | 8 layout findings | ✓ |
| todomvc-control | demo.playwright.dev/todomvc | I can't add a new todo | I can't add a new todo | not reproduced (2 steps) | ✓ |

7/7 as expected (the control should come back "not reproduced").
