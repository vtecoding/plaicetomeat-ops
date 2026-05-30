# Playwright UI Audit

Generated: 2026-05-30T10:47:23.818Z

**Passed flows:**
- /
- /shop
- /basket
- /counter
- /counter/compliance
- /admin
- /admin/products
- /admin/orders
- /admin/pickup-windows
- /admin/compliance
- /admin/settings

**Failed flows:**
- /checkout

**Details**

### /

- Passed: true
- HTTP status: 200

### /shop

- Passed: true
- HTTP status: 200
- Clicked buttons: `Add`

### /basket

- Passed: true
- HTTP status: 200

### /checkout

- Passed: false
- HTTP status: 200
- Page errors:
  - Checkout field #customerName is missing required attribute
  - Checkout field #customerPhone is missing required attribute
  - Checkout field #pickupDate is missing required attribute
  - Checkout field #pickupWindowId is missing required attribute

### /counter

- Passed: true
- HTTP status: 200

### /counter/compliance

- Passed: true
- HTTP status: 200

### /admin

- Passed: true
- HTTP status: 200

### /admin/products

- Passed: true
- HTTP status: 200

### /admin/orders

- Passed: true
- HTTP status: 200

### /admin/pickup-windows

- Passed: true
- HTTP status: 200

### /admin/compliance

- Passed: true
- HTTP status: 200

### /admin/settings

- Passed: true
- HTTP status: 200
