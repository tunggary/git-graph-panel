#!/usr/bin/env bash
# Builds a deterministic, good-looking demo repository for git-graph-panel
# screenshots and GIFs.
#
#   scripts/make-demo-repo.sh <empty-dir>
#
# The repository to open in Claude Code is <dir>; its remote is the bare
# repository <dir>.origin.git next to it. It is "acme-shop", a small web app
# with three authors and ~40 commits of Git Flow history:
#   - branches: main, develop, feature/checkout (merged), feature/search
#     (merged), feature/wishlist (in progress, local only), release/1.2.0 and
#     hotfix/1.1.1 (both merged into main and develop), plus
#     origin/feature/dark-mode, which exists only on the remote
#   - tags v1.0.0, v1.1.0, v1.1.1, v1.2.0
#   - GitHub-style "Merge pull request #N from acme/..." merge commits
#   - 5-6 lanes open at once near the top of the graph
#   - HEAD on develop, in sync with origin/develop
#   - three uncommitted changes (M, A, ??)
# The last line printed names a commit with a readable diff for screenshots.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <empty-dir>" >&2
  exit 1
fi

DIR="$1"
mkdir -p "$DIR"
if [ -n "$(ls -A "$DIR")" ]; then
  echo "error: $DIR is not empty" >&2
  exit 1
fi
DIR="$(cd "$DIR" && pwd)"

ORIGIN="$DIR.origin.git"
rm -rf "$ORIGIN"
git init -q --bare -b main "$ORIGIN"
cd "$DIR"
git init -q -b main

git config user.name "Alice Kim"
git config user.email "alice@acme.dev"
git config commit.gpgsign false
git config tag.gpgsign false
git remote add origin "$ORIGIN"

# Deterministic clock: every commit is 7 hours after the previous one,
# starting 2026-09-14 09:00 UTC. Authors rotate.
BASE=1789376400
TICK=0
AUTHORS=("Alice Kim|alice@acme.dev" "Bob Lee|bob@acme.dev" "Carol Park|carol@acme.dev")

stamp() {
  TICK=$((TICK + 1))
  export GIT_COMMITTER_DATE="$((BASE + TICK * 25200)) +0000"
  export GIT_AUTHOR_DATE="$GIT_COMMITTER_DATE"
  local who="${AUTHORS[$((TICK % 3))]}"
  export GIT_AUTHOR_NAME="${who%%|*}"
  export GIT_AUTHOR_EMAIL="${who##*|}"
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
  export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
}

# commit <subject> [body]: commits everything in the working tree.
commit() {
  git add -A
  stamp
  if [ $# -ge 2 ]; then
    git commit -q -m "$1" -m "$2"
  else
    git commit -q -m "$1"
  fi
}

# merge_pr <number> <branch> [title]: GitHub-style --no-ff merge commit.
merge_pr() {
  stamp
  if [ $# -ge 3 ]; then
    git merge -q --no-ff -m "Merge pull request #$1 from acme/$2" -m "$3" "$2" >/dev/null
  else
    git merge -q --no-ff -m "Merge pull request #$1 from acme/$2" "$2" >/dev/null
  fi
}

tag() {
  stamp
  git tag -a "$1" -m "$1" >/dev/null
}

# put <path>: writes stdin to <path>; append <path>: appends stdin to <path>.
put() { mkdir -p "$(dirname "$1")"; cat > "$1"; }
append() { cat >> "$1"; }

# package.json with a given version and react version.
pkg() {
  put package.json <<EOF
{
  "name": "acme-shop",
  "version": "$1",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "$2",
    "react-dom": "$2"
  }
}
EOF
}

# --- main: initial history ----------------------------------------------------
pkg 1.0.0 18.2.0
put .gitignore <<'EOF'
node_modules
dist
.env
EOF
commit "chore: initial commit"

put src/cart.ts <<'EOF'
export interface CartItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
}

const items: CartItem[] = [];

export function addItem(item: CartItem): void {
  items.push(item);
}

export function total(): number {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum;
}
EOF
commit "feat(cart): add cart module"

put src/search.ts <<'EOF'
export interface Product {
  sku: string;
  name: string;
  category: string;
}

export function search(products: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase();
  return products.filter((p) => p.name.toLowerCase().includes(q));
}
EOF
commit "feat(search): add product search"

put README.md <<'EOF'
# acme-shop

A small storefront built with React and TypeScript.

## Getting started

```sh
npm install
npm run dev
```
EOF
commit "docs: add getting started to README"

put .github/workflows/ci.yml <<'EOF'
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm test
EOF
commit "ci: add GitHub Actions workflow"

put .eslintrc.json <<'EOF'
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "root": true
}
EOF
commit "chore: configure eslint"
tag v1.0.0

# --- develop ------------------------------------------------------------------
git checkout -q -b develop
put src/cart.ts <<'EOF'
export interface CartItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
}

const items: CartItem[] = [];

export function addItem(item: CartItem): void {
  items.push(item);
}

export function setQuantity(sku: string, quantity: number): void {
  const item = items.find((i) => i.sku === sku);
  if (item) item.quantity = quantity;
}

export function total(): number {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum;
}
EOF
commit "feat(cart): add quantity stepper"

git checkout -q -b feature/search
append src/search.ts <<'EOF'

export function filterByCategory(products: Product[], category: string): Product[] {
  return category === "all" ? products : products.filter((p) => p.category === category);
}
EOF
commit "feat(search): filter results by category"

git checkout -q develop
append README.md <<'EOF'

## Features

- Cart with quantity stepper
- Product search
EOF
commit "docs: list features in README"

git checkout -q feature/search
append src/search.ts <<'EOF'

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
EOF
commit "fix(search): debounce input" "Typing used to fire one request per keystroke, which hammered the
product API and made results flicker. Wait 250ms after the last
keystroke before searching."

git checkout -q develop
merge_pr 4 feature/search "feat: product search filters"
pkg 1.0.0 18.3.1
commit "chore: bump deps"

# --- release 1.1.0 (branch is deleted after merging) ---------------------------
git checkout -q -b release/1.1.0
pkg 1.1.0 18.3.1
commit "chore: bump version to 1.1.0"
git checkout -q main
merge_pr 7 release/1.1.0
tag v1.1.0
git checkout -q develop
put src/format.ts <<'EOF'
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatPrice(cents: number): string {
  return usd.format(cents / 100);
}
EOF
commit "feat(format): add currency formatter"
merge_pr 8 release/1.1.0
git branch -q -d release/1.1.0

# --- parallel work: checkout, wishlist, dark mode, hotfix -----------------------
git checkout -q -b feature/checkout
append src/checkout.ts <<'EOF'
export interface Address {
  name: string;
  street: string;
  city: string;
  postalCode: string;
}

export function emptyAddress(): Address {
  return { name: "", street: "", city: "", postalCode: "" };
}
EOF
commit "feat(checkout): add shipping address form"

git checkout -q develop
git checkout -q -b feature/wishlist
put src/wishlist.ts <<'EOF'
const saved = new Set<string>();

export function toggle(sku: string): boolean {
  if (saved.has(sku)) {
    saved.delete(sku);
    return false;
  }
  saved.add(sku);
  return true;
}

export function list(): string[] {
  return [...saved];
}
EOF
commit "feat(wishlist): add wishlist store"

git checkout -q develop
git checkout -q -b feature/dark-mode
put src/theme.ts <<'EOF'
export const darkTokens = {
  background: "#0f1115",
  surface: "#1a1d23",
  text: "#e6e8eb",
  accent: "#6ea8fe",
};
EOF
commit "feat(theme): add dark color tokens"

git checkout -q main
git checkout -q -b hotfix/1.1.1
put src/cart.ts <<'EOF'
export interface CartItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
}

const items: CartItem[] = [];

export function addItem(item: CartItem): void {
  items.push(item);
}

export function setQuantity(sku: string, quantity: number): void {
  const item = items.find((i) => i.sku === sku);
  if (item) item.quantity = Math.max(1, quantity);
}

export function total(): number {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum;
}
EOF
commit "fix(cart): clamp quantity to at least 1"

git checkout -q feature/checkout
append src/checkout.ts <<'EOF'

export function isValidPostalCode(code: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(code);
}
EOF
commit "feat(checkout): validate postal code"

git checkout -q feature/wishlist
append src/wishlist.ts <<'EOF'

export function persist(): void {
  localStorage.setItem("wishlist", JSON.stringify(list()));
}
EOF
commit "feat(wishlist): persist items to localStorage"

git checkout -q feature/dark-mode
append src/theme.ts <<'EOF'

export function toggleTheme(root: HTMLElement): void {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
}
EOF
commit "feat(theme): add theme toggle"

git checkout -q hotfix/1.1.1
pkg 1.1.1 18.3.1
commit "chore: bump version to 1.1.1"
git checkout -q main
merge_pr 9 hotfix/1.1.1
tag v1.1.1

git checkout -q feature/checkout
append src/checkout.ts <<'EOF'

export type PaymentMethod = "card" | "paypal" | "bank-transfer";

export function paymentLabel(method: PaymentMethod): string {
  const labels: Record<PaymentMethod, string> = {
    card: "Credit card",
    paypal: "PayPal",
    "bank-transfer": "Bank transfer",
  };
  return labels[method];
}
EOF
commit "feat(checkout): add payment step"

git checkout -q develop
merge_pr 10 hotfix/1.1.1
# The commit used for the diff screenshot: adds and removes a meaningful chunk of code.
put src/cart.ts <<'EOF'
export interface CartItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
}

const BULK_THRESHOLD = 10;
const BULK_DISCOUNT = 0.1;

const items: CartItem[] = [];

function lineTotal(item: CartItem): number {
  const gross = item.price * item.quantity;
  return item.quantity >= BULK_THRESHOLD ? gross * (1 - BULK_DISCOUNT) : gross;
}

export function addItem(item: CartItem): void {
  const existing = items.find((i) => i.sku === item.sku);
  if (existing) {
    existing.quantity += item.quantity;
    return;
  }
  items.push(item);
}

export function setQuantity(sku: string, quantity: number): void {
  const item = items.find((i) => i.sku === sku);
  if (item) item.quantity = Math.max(1, quantity);
}

export function total(): number {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}
EOF
commit "feat(cart): apply bulk discount and merge duplicate items"
DIFF_COMMIT="$(git rev-parse --short HEAD) $(git log -1 --format=%s)"

git checkout -q feature/wishlist
append src/wishlist.ts <<'EOF'

export function heartLabel(sku: string): string {
  return list().includes(sku) ? "Remove from wishlist" : "Add to wishlist";
}
EOF
commit "feat(wishlist): add heart button to product cards"

git checkout -q feature/checkout
append src/checkout.ts <<'EOF'

export function orderSummary(subtotalCents: number, shippingCents: number): string {
  const total = subtotalCents + shippingCents;
  return `Subtotal ${subtotalCents}, shipping ${shippingCents}, total ${total}`;
}
EOF
commit "feat(checkout): show order summary"

git checkout -q feature/dark-mode
append src/theme.ts <<'EOF'

export function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
EOF
commit "fix(theme): respect prefers-color-scheme"

git checkout -q develop
merge_pr 12 feature/checkout "feat: checkout flow"

# --- release 1.2.0 ------------------------------------------------------------
git checkout -q -b release/1.2.0
pkg 1.2.0 18.3.1
commit "chore: bump version to 1.2.0"

git checkout -q feature/wishlist
put src/wishlist.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { list, toggle } from "./wishlist";

describe("wishlist", () => {
  it("adds and removes items", () => {
    expect(toggle("sku-1")).toBe(true);
    expect(list()).toContain("sku-1");
    expect(toggle("sku-1")).toBe(false);
  });
});
EOF
commit "test(wishlist): cover add and remove"

git checkout -q feature/dark-mode
append src/theme.ts <<'EOF'

export const darkSurfaceContrast = 1.35;
EOF
commit "style(theme): tune dark surface contrast"

git checkout -q develop
append src/search.ts <<'EOF'

export function resetFilters(): string {
  return "all";
}
EOF
commit "fix(search): keep category filter on clear"

git checkout -q release/1.2.0
put CHANGELOG.md <<'EOF'
# Changelog

## 1.2.0

- Checkout flow with shipping, payment and order summary
- Bulk discount for large quantities
- Duplicate cart items are merged

## 1.1.1

- Quantity can no longer go below 1
EOF
commit "docs: add 1.2.0 changelog"

git checkout -q main
merge_pr 14 release/1.2.0
tag v1.2.0
git checkout -q develop
merge_pr 15 release/1.2.0

# --- origin -------------------------------------------------------------------
# feature/wishlist stays local only; feature/dark-mode is kept on origin only,
# as if a teammate pushed it from another clone.
git push -q -u origin main develop feature/checkout feature/search release/1.2.0 hotfix/1.1.1 feature/dark-mode >/dev/null 2>&1
git push -q origin --tags >/dev/null 2>&1
git branch -q -D feature/dark-mode

# --- uncommitted changes (M, A, ??) -------------------------------------------
append README.md <<'EOF'

## Roadmap

- Wishlist
- Dark mode
EOF
put src/analytics.ts <<'EOF'
export function track(event: string, props: Record<string, unknown> = {}): void {
  console.debug("[analytics]", event, props);
}
EOF
git add src/analytics.ts
put scratch.md <<'EOF'
- ask design about empty cart state
- check shipping rates for Jeju
EOF

echo
echo "Created $DIR (origin: $ORIGIN)"
echo "  commits:  $(git rev-list --all --count)"
echo "  branches: $(git branch -a --format='%(refname:short)' | tr '\n' ' ')"
echo "  tags:     $(git tag | tr '\n' ' ')"
echo "Commit for the diff screenshot: $DIFF_COMMIT"
