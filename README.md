# QuickBooks Online MCP Server

<div align="center">

**A comprehensive Model Context Protocol (MCP) server for QuickBooks Online**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tools](https://img.shields.io/badge/Tools-146-green.svg)](#available-tools)
[![Entities](https://img.shields.io/badge/Entities-29-orange.svg)](#entities)
[![Reports](https://img.shields.io/badge/Reports-11-purple.svg)](#reports)
[![Coverage](https://img.shields.io/badge/Coverage-100%25-brightgreen.svg)](#testing)
[![Tests](https://img.shields.io/badge/Tests-662-blue.svg)](#testing)

[Quick Start](#quick-start) | [Available Tools](#available-tools) | [Authentication](#authentication) | [Documentation](#documentation)

</div>

---

## Overview

This MCP server provides complete QuickBooks Online API integration for Claude Code and other MCP-compatible clients. It includes full CRUD operations for 29 entity types and 11 financial reports, giving you comprehensive access to QuickBooks Online functionality.

### Key Features

- **146 Total Tools** - Complete coverage of QuickBooks Online API
- **29 Entity Types** - Full CRUD operations (Create, Read, Update, Delete, Search)
- **11 Financial Reports** - Balance Sheet, P&L, Cash Flow, and more
- **OAuth 2.0 Authentication** - Secure token-based authentication
- **TypeScript** - Full type safety with Zod validation
- **Tested** - Jest test suite with ESM support

---

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/mcp-quickbooks-online.git
cd mcp-quickbooks-online

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration

Copy the template `.env.example` to `.env` in the root directory and fill in your values:

```bash
cp .env.example .env
```

```env
QUICKBOOKS_CLIENT_ID=your_client_id
QUICKBOOKS_CLIENT_SECRET=your_client_secret
QBO_ENVIRONMENT=sandbox
QUICKBOOKS_REFRESH_TOKEN=your_refresh_token
QUICKBOOKS_REALM_ID=your_realm_id
```

`.env` is gitignored so your real credentials stay local. Write tools are off by default; see
[Sales receipt writes](#sales-receipt-writes) for `QBO_WRITE_ENABLED` and related settings.

### Claude Code Integration

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "quickbooks": {
      "command": "node",
      "args": ["path/to/mcp-quickbooks-online/dist/index.js"],
      "env": {
        "QUICKBOOKS_CLIENT_ID": "your_client_id",
        "QUICKBOOKS_CLIENT_SECRET": "your_client_secret",
        "QUICKBOOKS_REFRESH_TOKEN": "your_refresh_token",
        "QUICKBOOKS_REALM_ID": "your_realm_id",
        "QUICKBOOKS_ENVIRONMENT": "sandbox"
      }
    }
  }
}
```

---

## Available Tools

### Entities

Complete CRUD operations are available for all entity types:

| Entity | Create | Get | Update | Delete | Search |
|--------|:------:|:---:|:------:|:------:|:------:|
| **Customer** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Invoice** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Estimate** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Bill** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Vendor** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Employee** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Account** | ✅ | ✅ | ✅ | - | ✅ |
| **Item** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Journal Entry** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Bill Payment** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Purchase** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Payment** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Sales Receipt** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Credit Memo** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Refund Receipt** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Purchase Order** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Vendor Credit** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Deposit** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Transfer** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Time Activity** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Class** | ✅ | ✅ | ✅ | - | ✅ |
| **Department** | ✅ | ✅ | ✅ | - | ✅ |
| **Term** | ✅ | ✅ | ✅ | - | ✅ |
| **Payment Method** | ✅ | ✅ | ✅ | - | ✅ |
| **Tax Code** | - | ✅ | - | - | ✅ |
| **Tax Rate** | - | ✅ | - | - | ✅ |
| **Tax Agency** | - | ✅ | - | - | ✅ |
| **Company Info** | - | ✅ | ✅ | - | - |
| **Attachable** | ✅ | ✅ | ✅ | ✅ | ✅ |

### Reports

| Report | Tool Name | Description |
|--------|-----------|-------------|
| **Balance Sheet** | `get_balance_sheet` | Assets, liabilities, and equity snapshot |
| **Profit & Loss** | `get_profit_and_loss` | Income and expenses over a period |
| **Cash Flow** | `get_cash_flow` | Cash inflows and outflows |
| **Trial Balance** | `get_trial_balance` | Debit and credit balances |
| **General Ledger** | `get_general_ledger` | Complete transaction history |
| **Customer Sales** | `get_customer_sales` | Sales by customer |
| **Aged Receivables** | `get_aged_receivables` | Outstanding customer invoices |
| **Aged Receivables Detail** | `get_aged_receivables_detail` | Detailed aging breakdown |
| **Customer Balance** | `get_customer_balance` | Current customer balances |
| **Aged Payables** | `get_aged_payables` | Outstanding vendor bills |
| **Vendor Expenses** | `get_vendor_expenses` | Expenses by vendor |

---

## Tool Reference

<details>
<summary><strong>Customer Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_customer` | Create a customer or sub-customer, idempotent by DisplayName (see [Sales receipt writes](#sales-receipt-writes)) |
| `get_customer` | Get customer by ID |
| `update_customer` | Update customer details |
| `delete_customer` | Delete a customer |
| `search_customers` | Search customers with filters |

</details>

<details>
<summary><strong>Invoice Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_invoice` | Create a new invoice |
| `get_invoice` | Get invoice by ID |
| `update_invoice` | Update invoice details |
| `delete_invoice` | Delete/void an invoice |
| `search_invoices` | Search invoices with filters |

</details>

<details>
<summary><strong>Payment Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_payment` | Record a customer payment |
| `get_payment` | Get payment by ID |
| `update_payment` | Update payment details |
| `delete_payment` | Void a payment |
| `search_payments` | Search payments with filters |

</details>

<details>
<summary><strong>Bill & Vendor Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_bill` | Create a new bill |
| `get_bill` | Get bill by ID |
| `update_bill` | Update bill details |
| `delete_bill` | Delete a bill |
| `search_bills` | Search bills with filters |
| `create_vendor` | Create a new vendor |
| `get_vendor` | Get vendor by ID |
| `update_vendor` | Update vendor details |
| `delete_vendor` | Delete a vendor |
| `search_vendors` | Search vendors with filters |
| `create_bill_payment` | Create a bill payment |
| `get_bill_payment` | Get bill payment by ID |
| `update_bill_payment` | Update bill payment |
| `delete_bill_payment` | Delete a bill payment |
| `search_bill_payments` | Search bill payments |

</details>

<details>
<summary><strong>Sales Receipt & Credit Memo Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_sales_receipt` | Create a donation sales receipt, idempotently (see [Sales receipt writes](#sales-receipt-writes)) |
| `get_sales_receipt` | Get sales receipt by ID |
| `find_sales_receipt_by_doc_number` | Find a sales receipt by DocNumber; returns the receipt or null |
| `void_sales_receipt` | Void a sales receipt (keeps the audit trail) |
| `update_sales_receipt` | Update sales receipt |
| `delete_sales_receipt` | Delete a sales receipt |
| `search_sales_receipts` | Search sales receipts |
| `create_credit_memo` | Create a credit memo |
| `get_credit_memo` | Get credit memo by ID |
| `update_credit_memo` | Update credit memo |
| `delete_credit_memo` | Void a credit memo |
| `search_credit_memos` | Search credit memos |
| `create_refund_receipt` | Create a refund receipt |
| `get_refund_receipt` | Get refund receipt by ID |
| `update_refund_receipt` | Update refund receipt |
| `delete_refund_receipt` | Void a refund receipt |
| `search_refund_receipts` | Search refund receipts |

</details>

<details>
<summary><strong>Banking Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_deposit` | Create a bank deposit |
| `get_deposit` | Get deposit by ID |
| `update_deposit` | Update deposit details |
| `delete_deposit` | Delete a deposit |
| `search_deposits` | Search deposits |
| `create_transfer` | Create an account transfer |
| `get_transfer` | Get transfer by ID |
| `update_transfer` | Update transfer details |
| `delete_transfer` | Delete a transfer |
| `search_transfers` | Search transfers |

</details>

<details>
<summary><strong>Purchase Order & Vendor Credit Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_purchase_order` | Create a purchase order |
| `get_purchase_order` | Get purchase order by ID |
| `update_purchase_order` | Update purchase order |
| `delete_purchase_order` | Delete a purchase order |
| `search_purchase_orders` | Search purchase orders |
| `create_vendor_credit` | Create a vendor credit |
| `get_vendor_credit` | Get vendor credit by ID |
| `update_vendor_credit` | Update vendor credit |
| `delete_vendor_credit` | Delete a vendor credit |
| `search_vendor_credits` | Search vendor credits |

</details>

<details>
<summary><strong>Time Tracking Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_time_activity` | Create a time activity |
| `get_time_activity` | Get time activity by ID |
| `update_time_activity` | Update time activity |
| `delete_time_activity` | Delete a time activity |
| `search_time_activities` | Search time activities |

</details>

<details>
<summary><strong>Classification Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_class` | Create a class |
| `get_class` | Get class by ID |
| `update_class` | Update class details |
| `search_classes` | Search classes |
| `create_department` | Create a department |
| `get_department` | Get department by ID |
| `update_department` | Update department |
| `search_departments` | Search departments |

</details>

<details>
<summary><strong>Settings Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_term` | Create a payment term |
| `get_term` | Get term by ID |
| `update_term` | Update term details |
| `search_terms` | Search terms |
| `create_payment_method` | Create a payment method |
| `get_payment_method` | Get payment method by ID |
| `update_payment_method` | Update payment method |
| `search_payment_methods` | Search payment methods |

</details>

<details>
<summary><strong>Tax Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `get_tax_code` | Get tax code by ID |
| `search_tax_codes` | Search tax codes |
| `get_tax_rate` | Get tax rate by ID |
| `search_tax_rates` | Search tax rates |
| `get_tax_agency` | Get tax agency by ID |
| `search_tax_agencies` | Search tax agencies |

</details>

<details>
<summary><strong>Company & Attachments</strong></summary>

| Tool | Description |
|------|-------------|
| `get_company_info` | Get company information |
| `update_company_info` | Update company info |
| `create_attachable` | Create an attachment |
| `get_attachable` | Get attachment by ID |
| `update_attachable` | Update attachment |
| `delete_attachable` | Delete an attachment |
| `search_attachables` | Search attachments |

</details>

---

## Sales receipt writes

`create_sales_receipt`, `void_sales_receipt` and `create_customer` are built for an
automated routine that books donations (HubSpot gift records) into QBO. They are safe to
call repeatedly and never write unless the server is explicitly configured to.

All tools take a single `params` object. A client that sends `params` as a JSON string is
also accepted.

### Write guards

| Variable | Default | Effect |
|---|---|---|
| `QBO_ENVIRONMENT` | `sandbox` | `sandbox` -> `https://sandbox-quickbooks.api.intuit.com`, `production` -> `https://quickbooks.api.intuit.com`. Falls back to `QUICKBOOKS_ENVIRONMENT`; if both are set they must agree. |
| `QBO_WRITE_ENABLED` | `false` | When not `true`, every write tool returns a dry run regardless of input and logs a warning. |
| `QBO_PRODUCTION_WRITES_CONFIRMED` | `false` | In production, `create_sales_receipt` and `void_sales_receipt` are refused unless this is also `true`. |
| `QBO_ALLOWED_NEGATIVE_ITEM_IDS` | empty | Comma separated item IDs allowed on a negative line (the merchant/platform fees item). Empty means no negative lines. |

To enable real writes against the sandbox: `QBO_ENVIRONMENT=sandbox QBO_WRITE_ENABLED=true
QBO_ALLOWED_NEGATIVE_ITEM_IDS=<fees item id>`. Production additionally needs
`QBO_ENVIRONMENT=production QBO_PRODUCTION_WRITES_CONFIRMED=true`.

Every write-tool outcome is logged to stderr as one line, `[qbo-write] {...}`, with the tool,
idempotency key, doc number, QBO ID, environment and result (`created`, `already_exists`,
`dry_run`, `voided`, `already_voided`, `error`). Logs carry identifiers only: no memo text,
names, emails, addresses, QBO fault text or tokens.

There are deliberately no tools here for creating or changing accounts, items or classes on
the hosted deployment; finance owns the chart of accounts.

### `create_sales_receipt`

`POST /v3/company/{realmId}/salesreceipt?requestid={idempotency_key}&minorversion=75`

| Field | Type | Required | Maps to |
|---|---|---|---|
| `idempotency_key` | string (max 50) | yes | `requestid` query param. Use the HubSpot Gift record ID. |
| `doc_number` | string (max 21) | yes | `DocNumber`. Use the HubSpot Gift record ID. |
| `txn_date` | `YYYY-MM-DD` | yes | `TxnDate` (donation date) |
| `customer_id` | string | yes | `CustomerRef.value` |
| `deposit_to_account_id` | string | yes | `DepositToAccountRef.value`; must be an Undeposited Funds account |
| `department_id` | string | yes | `DepartmentRef.value` |
| `private_note` | string (max 4000) | yes | `PrivateNote`; IDs only |
| `lines` | array, min 1 | yes | `Line[]`: `{ item_id, class_id, amount, description? }` -> `SalesItemLineDetail` with `ItemRef`, `ClassRef`, `Qty: 1`, `UnitPrice: amount` |
| `dry_run` | boolean | no, default `true` | Validate and return the payload without writing |

Before writing, the tool checks (and writes nothing if any fails):

- every amount is finite, non-zero and has at most 2 decimal places, and the total is greater than 0;
- at most one line is negative, and only on an item in `QBO_ALLOWED_NEGATIVE_ITEM_IDS`;
- the customer, deposit account, department and every item and class exist and are active;
- the deposit account has `AccountSubType = UndepositedFunds`, so a receipt never posts straight to a bank account;
- no sales receipt with the same `DocNumber` exists. If one does, it is returned with `status: "already_exists"`.

`dry_run` still does these read-only lookups. Output:
`{ status: "created" | "already_exists" | "dry_run", id, doc_number, total_amt, txn_date, payload, environment, dry_run_reason?, sales_receipt? }`.

### `get_sales_receipt` / `find_sales_receipt_by_doc_number`

`get_sales_receipt` takes `{ id }`. `find_sales_receipt_by_doc_number` takes `{ doc_number }`
and returns the receipt or `null`.

### `void_sales_receipt`

Takes `{ id, reason }`. Reads the receipt for its current `SyncToken`, then sends
`POST /salesreceipt?operation=update&include=void` (a sparse update; `operation=void` only
voids a QuickBooks Payments card charge and fails on ordinary receipts) with `Id`, `SyncToken` and the reason appended to
`PrivateNote` (with a `[VOIDED by MCP]` marker). A receipt that already carries the marker
returns `status: "already_voided"`. Voiding keeps the record and audit trail; use it instead of
delete.

### `create_customer`

Takes `{ display_name, company_name?, parent_id?, dry_run? (default true) }`. With
`parent_id` it creates a sub-customer (`ParentRef`, `Job: true`, `BillWithParent: true`).
It first looks up the DisplayName (active and inactive); if it exists the customer is
returned with `status: "already_exists"`.

---

## Authentication

### Getting QuickBooks API Credentials

1. Go to the [Intuit Developer Portal](https://developer.intuit.com/)
2. Create a new app or select an existing one
3. Get the **Client ID** and **Client Secret** from the app's keys section
4. Add `http://localhost:8000/callback` to the app's Redirect URIs

### Option 1: Using Environment Variables (Recommended)

If you have existing tokens:

```env
QUICKBOOKS_CLIENT_ID=your_client_id
QUICKBOOKS_CLIENT_SECRET=your_client_secret
QUICKBOOKS_REFRESH_TOKEN=your_refresh_token
QUICKBOOKS_REALM_ID=your_realm_id
QUICKBOOKS_ENVIRONMENT=sandbox
```

### Option 2: OAuth Flow

If you don't have tokens, the server can initiate an OAuth flow that:
- Starts a temporary local server
- Opens your browser for authentication
- Saves tokens to your `.env` file
- Closes automatically when complete

---

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

The test suite includes **396 tests** with **100% code coverage** across all metrics (statements, branches, functions, lines).

### Project Structure

```
src/
├── clients/          # QuickBooks API client
├── handlers/         # Business logic handlers (87 files)
├── tools/           # MCP tool definitions
├── helpers/         # Utility functions
├── types/           # TypeScript types
└── index.ts         # Server entry point

tests/
├── unit/            # Unit tests (396 tests)
│   ├── handlers/    # Handler tests (15 test files)
│   └── helpers/     # Helper tests
└── mocks/           # Test mocks

docs/
├── ARCHITECTURE.md  # System architecture & design patterns
├── TESTING.md       # Testing guide & patterns
└── plans/           # Development plans
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [CHANGELOG.md](CHANGELOG.md) | Version history and all changes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, patterns, and design decisions |
| [docs/TESTING.md](docs/TESTING.md) | Testing strategy, ESM patterns, and coverage guide |

---

## Error Handling

If you encounter connection errors:

1. Verify all environment variables are set correctly
2. Check that tokens are valid and not expired
3. Ensure the QuickBooks app has the correct redirect URIs
4. For sandbox testing, use `QUICKBOOKS_ENVIRONMENT=sandbox`

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Based on [Intuit's QuickBooks Online MCP Server](https://github.com/intuit/quickbooks-online-mcp-server)
- Built with the [Model Context Protocol](https://modelcontextprotocol.io/)
