# Security Specification

This document details the security specification for Selaali B2B Firestore schema and the associated rules, acting as a guide and red-team reference.

## 1. Data Invariants

1. **Product Ownership & Write Access**:
   - Only validated merchants can create, edit, or delete products.
   - The product's `sellerId` must strictly map to the authenticated user's ID (`request.auth.uid`).
   - A product cannot be modified to swap `sellerId` (immutability).

2. **User Profiles Integrity**:
   - Every user has a document at `/users/{userId}` where `{userId}` must equal their authentication UID.
   - Users cannot edit another user's profile.
   - The user's role MUST be either `merchant` or `customer`.

3. **Order Transactions Rigor**:
   - Orders are registered at `/orders/{orderId}`.
   - The order's `buyerId` must match the authenticated creator's UID.
   - Orders can only be read by the buyer or by the merchants who fulfill items within that order.
   - No customer can modify an already placed order's terminal status without store consent.

---

## 2. The "Dirty Dozen" Malicious Payloads

The rules are engineered to deny and isolate the following payloads:

### Payload 1: Spurious Seller Product Hijack
An authenticated merchant `user_id_A` attempts to create a product claiming to be merchant `user_id_B`.
```json
// Collection: products
{
  "id": "prod_123",
  "name": "طماطم معلبة ممتازة",
  "price": 120,
  "qty": 500,
  "store": "شركة الأمانة",
  "category": "مواد غذائية",
  "unit": "صندوق",
  "minOrder": 10,
  "sellerId": "user_id_B" // Hijacked sellerId
}
```

### Payload 2: Negative/Invalid Pricing Attack
A malicious merchant attempts to set a product price to a negative number or a string.
```json
// Collection: products
{
  "id": "prod_124",
  "name": "دقيق ممتاز",
  "price": -100, // Invalid price
  "qty": 100,
  "store": "شركة الأمانة",
  "category": "مواد غذائية",
  "unit": "كيس",
  "minOrder": 5,
  "sellerId": "user_id_A"
}
```

### Payload 3: Cross-User Profile Tampering
Merchant `user_id_A` attempts to write/write-to/create a profile document inside `users/user_id_B`.
```json
// Path: users/user_id_B
{
  "name": "تزوير الهوية",
  "role": "merchant",
  "store_name": "المتجر المزيف",
  "business_type": "تجارة عامة",
  "store_logo": "📦",
  "store_theme": "emerald"
}
```

### Payload 4: Invalid User Role Privilege Escalation
A customer profile trying to register with a bogus role outside "merchant" or "customer" (e.g. "admin").
```json
// Path: users/user_id_C
{
  "name": "عمر",
  "role": "admin", // Privilege escalation
  "store_name": "بوابة الإدارة",
  "business_type": "خدمات عامة",
  "store_logo": "👑",
  "store_theme": "indigo"
}
```

### Payload 5: Slandering Product Inventory (Zero Quantity Leak)
An attacker attempting to update another merchant's product quantity to negative to block trading.
```json
// Path: products/prod_123
{
  "qty": -500 // Malicious update
}
```

### Payload 6: Spoofed Buyer Order Creation
An authenticated user `user_id_A` attempts to place an order under `buyerId: "user_id_B"`.
```json
// Collection: orders
{
  "id": "order_789",
  "buyerName": "سمير الضحية",
  "buyerId": "user_id_B", // Spoofed recipient ID
  "items": [],
  "totalPrice": 12000,
  "status": "pending",
  "date": "2026-06-04"
}
```

### Payload 7: Denial of Wallet - Junk IDs Injection
Attacker attempting to register products with 10KB string ID values.
```json
// Path: products/<10KB string of junk characters>
{
  "name": "تنصل المحفظة"
}
```

### Payload 8: Order Status Self-Approval Hack
A customer attempts to update their pending order status directly to `approved` or `completed` without the merchant's confirmation block.
```json
// Path: orders/order_789
{
  "status": "completed" // Direct transition attempt
}
```

### Payload 9: Empty/Unbounded Order Items Array
An attacker attempts to send an order containing 5000+ nested lines to overflow Firebase document parsing.
```json
// Path: orders/order_789
{
  "items": [ /* 5000 random lines */ ]
}
```

### Payload 10: Unauthorized Order Reading Query (Gid Scraping)
A customer attempts to fetch another buyer's private business invoice documents.
```json
// Path: orders/any_other_order
// Goal: GET /orders/order_belonging_to_B
```

### Payload 11: Immutable Field Overwrite (Date/Buyer ID change)
A customer attempting to change the original transaction `date` or `buyerId` of an order.
```json
// Path: orders/order_789
{
  "date": "2020-01-01" // Changing date
}
```

### Payload 12: Invalid Measurement Units Attack
An attacker trying to pass unsupported high-volume arrays or floats inside the `minOrder` or `unit` constraints.
```json
// Path: products/prod_125
{
  "minOrder": 0.0001,
  "unit": "جرام"
}
```

---

## 3. Test Specification Runner Check
All 12 test payloads must return `PERMISSION_DENIED` under custom firestore security test assertions.
