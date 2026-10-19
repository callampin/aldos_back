CREATE TABLE `admins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`reset_token_hash` text,
	`reset_token_expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_email_unique` ON `admins` (`email`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `motorcycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand` text NOT NULL,
	`model` text NOT NULL,
	`line` text NOT NULL,
	`year_from` integer,
	`year_to` integer
);
--> statement-breakpoint
CREATE INDEX `idx_motorcycles_brand_model` ON `motorcycles` (`brand`,`model`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`sku_snapshot` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`unit_price_clp` integer NOT NULL,
	`quantity` integer NOT NULL,
	`line_total_clp` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_number` text NOT NULL,
	`tracking_code` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_rut` text,
	`customer_email` text NOT NULL,
	`customer_phone` text NOT NULL,
	`delivery_method` text NOT NULL,
	`region_code` text NOT NULL,
	`region_name` text NOT NULL,
	`comuna` text NOT NULL,
	`address_line` text NOT NULL,
	`address_reference` text,
	`customer_notes` text,
	`subtotal_clp` integer NOT NULL,
	`shipping_cost_clp` integer NOT NULL,
	`total_clp` integer NOT NULL,
	`payment_method` text NOT NULL,
	`payment_status` text DEFAULT 'PENDING' NOT NULL,
	`payment_external_id` text,
	`payment_proof_url` text,
	`order_status` text DEFAULT 'PENDING' NOT NULL,
	`courier_name` text,
	`courier_tracking_number` text,
	`stock_deducted` integer DEFAULT false NOT NULL,
	`paid_at` integer,
	`shipped_at` integer,
	`delivered_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_order_number` ON `orders` (`order_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_tracking_code` ON `orders` (`tracking_code`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`order_status`);--> statement-breakpoint
CREATE INDEX `idx_orders_payment_status` ON `orders` (`payment_status`);--> statement-breakpoint
CREATE TABLE `product_compatibility` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`motorcycle_id` integer NOT NULL,
	`year_from_override` integer,
	`year_to_override` integer,
	`fitment_notes` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`motorcycle_id`) REFERENCES `motorcycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_product_compatibility_unique` ON `product_compatibility` (`product_id`,`motorcycle_id`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`r2_key` text NOT NULL,
	`url` text NOT NULL,
	`alt_text` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_product_images_product` ON `product_images` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`category_id` integer,
	`description` text,
	`oem_part_number` text,
	`price_clp` integer NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 1 NOT NULL,
	`sale_mode` text DEFAULT 'DIRECT' NOT NULL,
	`condition` text DEFAULT 'NEW' NOT NULL,
	`is_universal` integer DEFAULT false NOT NULL,
	`weight_grams` integer DEFAULT 500,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_sku` ON `products` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_slug` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_products_category_active` ON `products` (`category_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_products_oem` ON `products` (`oem_part_number`);--> statement-breakpoint
CREATE TABLE `shipping_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`region_code` text NOT NULL,
	`region_name` text NOT NULL,
	`base_cost_clp` integer NOT NULL,
	`is_payable_on_delivery` integer DEFAULT false NOT NULL,
	`estimated_days` text NOT NULL,
	`courier_name` text DEFAULT 'Courier Propio / Convenio' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipping_rates_region_code_unique` ON `shipping_rates` (`region_code`);--> statement-breakpoint
CREATE TABLE `stock_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`customer_name` text NOT NULL,
	`customer_contact` text NOT NULL,
	`is_notified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stock_alerts_product` ON `stock_alerts` (`product_id`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
