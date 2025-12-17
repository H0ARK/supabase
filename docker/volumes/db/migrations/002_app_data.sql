-- App Data Import from Supabase Cloud
-- Generated: 2025-11-25

-- Insert profiles
INSERT INTO profiles (id, username, avatar_url, bio, followers_count, following_count, collection_value, total_cards, portfolios_count, created_at, updated_at) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'Dev User', NULL, NULL, 1, 1, 0, 0, 1, '2025-11-16 01:00:02.469779+00', '2025-11-25 01:06:34.128567+00'),
('550e8400-e29b-41d4-a716-446655440001', 'yugiohlegend@test.com', NULL, NULL, 0, 0, 0, 0, 1, '2025-11-16 01:00:02.469779+00', '2025-11-25 01:06:34.128567+00'),
('550e8400-e29b-41d4-a716-446655440002', 'magiccollector@test.com', NULL, NULL, 0, 0, 0, 0, 1, '2025-11-16 01:00:02.469779+00', '2025-11-25 01:06:34.128567+00'),
('550e8400-e29b-41d4-a716-446655440003', 'cardtraderpro@test.com', NULL, NULL, 0, 0, 0, 0, 1, '2025-11-16 01:00:02.469779+00', '2025-11-25 01:06:34.128567+00'),
('550e8400-e29b-41d4-a716-446655440004', 'vintagetrader@test.com', NULL, NULL, 0, 0, 0, 0, 1, '2025-11-16 01:00:02.469779+00', '2025-11-25 01:06:34.128567+00'),
('2fa05548-0252-4923-863a-b54fd6aec3ee', 'Hoark', 'https://lh3.googleusercontent.com/a/ACg8ocICRUNVczdrzHOGc7i2qeaNvNurTLmaSLb1RhPzXvMoA79Gud0rQg=s96-c', NULL, 1, 1, 0, 13, 4, '2025-11-16 01:00:02.469779+00', '2025-11-25 01:06:34.128567+00'),
('7647a0c5-aeda-43d5-ba78-3947693fc6fc', 'christoph.sk42', NULL, NULL, 0, 0, 0, 0, 0, '2025-11-25 00:57:58.108703+00', '2025-11-25 01:06:34.128567+00')
ON CONFLICT (id) DO NOTHING;

-- Insert portfolios
INSERT INTO portfolios (id, user_id, name, description, is_default, is_public, display_order, created_at, updated_at) VALUES
('0262699d-a09a-47bc-8a1f-f3bed5f5a701', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Main', 'Your main card collection', true, false, 0, '2025-11-07T20:10:45.151547+00:00', '2025-11-07T20:10:45.151547+00:00'),
('fb0f2c34-0c5e-4f47-82a6-99a399c760e4', '550e8400-e29b-41d4-a716-446655440000', 'Main', 'Your main card collection', true, false, 0, '2025-11-07T20:10:45.151547+00:00', '2025-11-07T20:10:45.151547+00:00'),
('6f6067bd-dc07-42ad-adc4-c47cc89d9d20', '550e8400-e29b-41d4-a716-446655440001', 'Main', 'Your main card collection', true, false, 0, '2025-11-13T01:32:42.364686+00:00', '2025-11-13T01:32:42.364686+00:00'),
('7782983c-b7ff-4fbf-b2e6-ff57f1b22246', '550e8400-e29b-41d4-a716-446655440002', 'Main', 'Your main card collection', true, false, 0, '2025-11-13T01:32:42.364686+00:00', '2025-11-13T01:32:42.364686+00:00'),
('14d833dc-0fd4-4f98-b623-6784604ec5b2', '550e8400-e29b-41d4-a716-446655440003', 'Main', 'Your main card collection', true, false, 0, '2025-11-13T01:32:42.364686+00:00', '2025-11-13T01:32:42.364686+00:00'),
('8aa7a8af-976f-4820-a869-50013f2f6225', '550e8400-e29b-41d4-a716-446655440004', 'Main', 'Your main card collection', true, false, 0, '2025-11-13T01:32:42.364686+00:00', '2025-11-13T01:32:42.364686+00:00'),
('06784bc3-3339-4b0d-91d7-d289731166f9', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Trading', 'Cards for trading and flipping', false, false, 0, '2025-11-13T15:49:31.629438+00:00', '2025-11-13T15:49:31.629438+00:00'),
('4eb4631e-e347-4b41-97ac-d058a5b38e23', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Investment', 'Long-term investment cards', false, false, 0, '2025-11-13T15:49:31.894574+00:00', '2025-11-13T15:49:31.894574+00:00'),
('1f7f7860-76cd-4073-9d2b-b3da1e833673', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Wishlist', 'Cards you want to acquire', false, false, 0, '2025-11-13T15:49:32.105563+00:00', '2025-11-13T15:49:32.105563+00:00'),
('17505bc3-f463-4e43-8fb5-9bdb765e7244', '7647a0c5-aeda-43d5-ba78-3947693fc6fc', 'Main', 'Your main card collection', true, false, 0, '2025-11-25T00:57:58.108703+00:00', '2025-11-25T00:57:58.108703+00:00')
ON CONFLICT (id) DO NOTHING;

-- Insert user_collections
INSERT INTO user_collections (id, user_id, tcgdex_card_id, quantity, condition, acquired_date, notes, created_at, updated_at, portfolio_id, tcgplayer_product_id, rarity, card_variant_id) VALUES
('56e8d799-f003-4447-a718-9a5bff612c03', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 2, 'NM', NULL, NULL, '2025-11-12T05:04:24.007293+00:00', '2025-11-24T20:15:07.268527+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 84189, 'Holo Rare', 1),
('43dca13a-ef1d-4181-9b47-c838cb7643f0', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 1, 'NM', NULL, NULL, '2025-11-24T20:15:10.344155+00:00', '2025-11-24T20:15:10.344155+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 84189, NULL, 2),
('c1c81020-078d-44e6-98c4-0d3fe7c93cea', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 2, 'NM', NULL, NULL, '2025-11-24T20:02:20.128272+00:00', '2025-11-24T20:15:30.895904+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 83862, NULL, 6),
('bf742d0a-7ec4-40a9-8324-7bc48d77ed54', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 3, 'NM', NULL, NULL, '2025-11-24T20:02:07.450402+00:00', '2025-11-24T20:15:37.062588+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 83862, NULL, 4),
('9a46c2fd-1524-40b8-ae9b-0266eedfc878', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 2, 'NM', NULL, NULL, '2025-11-12T05:09:24.523709+00:00', '2025-11-24T22:13:07.55293+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 654395, 'Rare', 1),
('23207d05-84fd-4803-ad71-e79a12059d5c', '7647a0c5-aeda-43d5-ba78-3947693fc6fc', NULL, 1, 'NM', NULL, NULL, '2025-11-25T01:11:58.634479+00:00', '2025-11-25T01:11:58.634479+00:00', '17505bc3-f463-4e43-8fb5-9bdb765e7244', 454373, NULL, 2),
('9d7186f0-6ef5-45cf-808a-6e82db98140c', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 2, 'NM', NULL, NULL, '2025-11-11T01:38:25.794238+00:00', '2025-11-24T19:55:47.83205+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 246933, NULL, 1),
('8575e902-bd38-4e40-a957-735ff60ee18d', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 3, 'NM', NULL, NULL, '2025-11-11T02:40:42.548736+00:00', '2025-11-24T19:55:47.83205+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 654458, NULL, 1),
('ae94b427-9c23-42ba-b0c0-51c94f29b346', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 2, 'NM', NULL, NULL, '2025-11-11T16:01:22.548554+00:00', '2025-11-24T19:55:47.83205+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 523850, NULL, 1),
('8c26b759-ae16-4d4d-a8a9-bf3d740c6e8a', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 3, 'NM', NULL, NULL, '2025-11-10T17:31:57.952271+00:00', '2025-11-24T19:55:47.83205+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 284251, 'Ultra Rare', 1),
('d9e7a2e7-61ae-4ed4-88a7-9ee9f5247d39', '2fa05548-0252-4923-863a-b54fd6aec3ee', NULL, 2, 'NM', NULL, NULL, '2025-11-11T23:32:57.37497+00:00', '2025-11-24T19:55:47.83205+00:00', '0262699d-a09a-47bc-8a1f-f3bed5f5a701', 83862, NULL, 1)
ON CONFLICT (id) DO NOTHING;

-- Insert user_settings
INSERT INTO user_settings (id, user_id, notifications_email, notifications_push, notifications_price_alerts, notifications_new_followers, notifications_trades, privacy_profile_public, privacy_show_collection, privacy_show_activity, appearance_accent_color, appearance_theme, preferences_default_view, preferences_currency, preferences_language, notifications_marketing, notifications_weekly_digest, security_two_factor_enabled, security_two_factor_method, created_at, updated_at) VALUES
('77232360-9c5a-431a-8e84-866b14c0a072', '550e8400-e29b-41d4-a716-446655440000', true, true, false, true, true, true, true, false, NULL, 'dark', 'grid', 'USD', 'en', false, false, false, NULL, '2025-11-25T15:05:13.120987+00:00', '2025-11-25T15:05:13.120987+00:00'),
('1c7d8c86-8b18-4f23-8533-a87cff782f72', '550e8400-e29b-41d4-a716-446655440001', true, true, false, true, true, true, true, false, NULL, 'dark', 'grid', 'USD', 'en', false, false, false, NULL, '2025-11-25T15:05:13.120987+00:00', '2025-11-25T15:05:13.120987+00:00'),
('54f3240f-b019-4df1-9278-001b24abc659', '550e8400-e29b-41d4-a716-446655440002', true, true, false, true, true, true, true, false, NULL, 'dark', 'grid', 'USD', 'en', false, false, false, NULL, '2025-11-25T15:05:13.120987+00:00', '2025-11-25T15:05:13.120987+00:00'),
('00725d5b-0991-4ed9-9086-0690bdfaa7e5', '550e8400-e29b-41d4-a716-446655440003', true, true, false, true, true, true, true, false, NULL, 'dark', 'grid', 'USD', 'en', false, false, false, NULL, '2025-11-25T15:05:13.120987+00:00', '2025-11-25T15:05:13.120987+00:00'),
('0d8ce507-295a-438a-a23a-ab7d31f8c29c', '550e8400-e29b-41d4-a716-446655440004', true, true, false, true, true, true, true, false, NULL, 'dark', 'grid', 'USD', 'en', false, false, false, NULL, '2025-11-25T15:05:13.120987+00:00', '2025-11-25T15:05:13.120987+00:00'),
('b29618c4-8e5c-4d76-b1c2-0b6ae1c467dd', '7647a0c5-aeda-43d5-ba78-3947693fc6fc', true, true, false, true, true, true, true, false, NULL, 'dark', 'grid', 'USD', 'en', false, false, false, NULL, '2025-11-25T15:05:13.120987+00:00', '2025-11-25T15:05:13.120987+00:00'),
('4f0ab1e8-1eab-451f-9cb5-e8ab83b6e4e6', '2fa05548-0252-4923-863a-b54fd6aec3ee', true, true, false, true, true, true, true, false, '142 71% 45%', 'dark', 'grid', 'USD', 'en', false, false, false, NULL, '2025-11-25T15:05:13.120987+00:00', '2025-11-25T18:52:47.50397+00:00')
ON CONFLICT (id) DO NOTHING;

-- Insert user_follows
INSERT INTO user_follows (id, follower_id, following_id, created_at) VALUES
('6fbb8b56-ce91-4fa7-b86f-30533bb34254', '2fa05548-0252-4923-863a-b54fd6aec3ee', '550e8400-e29b-41d4-a716-446655440000', '2025-11-11T23:59:33.090503+00:00'),
('b8b9c3ce-d92a-47f2-8099-3758c5fd2083', '550e8400-e29b-41d4-a716-446655440000', '2fa05548-0252-4923-863a-b54fd6aec3ee', '2025-11-11T23:59:33.090503+00:00')
ON CONFLICT (id) DO NOTHING;

-- Insert user_groups
INSERT INTO user_groups (id, name, description, avatar_url, banner_url, created_by, is_private, member_count, category, rules, created_at, updated_at) VALUES
('132aa88d-50ee-4234-b724-62847426c941', 'Pokemon Collectors', 'A group for Pokemon TCG enthusiasts', NULL, NULL, '2fa05548-0252-4923-863a-b54fd6aec3ee', false, 1, NULL, NULL, '2025-11-11T23:59:33.090503+00:00', '2025-11-11T23:59:33.090503+00:00')
ON CONFLICT (id) DO NOTHING;

-- Insert group_members
INSERT INTO group_members (id, group_id, user_id, role, joined_at) VALUES
('5f87e2f6-c23d-44df-84d5-0f77d4b73d36', '132aa88d-50ee-4234-b724-62847426c941', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'owner', '2025-11-11T23:59:33.090503+00:00'),
('80e99fab-cf10-413d-9711-3b55374b99ef', '132aa88d-50ee-4234-b724-62847426c941', '550e8400-e29b-41d4-a716-446655440000', 'member', '2025-11-11T23:59:33.090503+00:00')
ON CONFLICT (id) DO NOTHING;

-- Insert group_posts
INSERT INTO group_posts (id, group_id, author_id, title, content, is_pinned, is_locked, reply_count, last_reply_at, created_at, updated_at) VALUES
('fd30ebec-9f31-4d0a-b3db-c174cceb58f6', '132aa88d-50ee-4234-b724-62847426c941', '550e8400-e29b-41d4-a716-446655440000', 'Looking for Pikachu', 'Anyone have Pikachu cards they want to trade?', false, false, 0, '2025-11-11T23:59:33.090503+00:00', '2025-11-11T23:59:33.090503+00:00', '2025-11-11T23:59:33.090503+00:00'),
('d16abec9-100c-461a-b333-11c737ca3b03', '132aa88d-50ee-4234-b724-62847426c941', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Collection Update', 'Reached 500 cards in my collection!', false, false, 0, '2025-11-11T23:59:33.090503+00:00', '2025-11-11T23:59:33.090503+00:00', '2025-11-11T23:59:33.090503+00:00'),
('3406bfe5-ee11-43d6-af43-f3d0eea646d1', '132aa88d-50ee-4234-b724-62847426c941', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'My Charizard Collection', 'Just added a 1st Edition Charizard to my collection!', false, false, 1, '2025-11-24T17:40:52.171458+00:00', '2025-11-11T23:59:33.090503+00:00', '2025-11-11T23:59:33.090503+00:00')
ON CONFLICT (id) DO NOTHING;

-- Insert posts
INSERT INTO posts (id, user_id, content, parent_post_id, repost_of_id, created_at, updated_at, likes_count, replies_count, reposts_count) VALUES
('e90c5344-8b86-4c61-9e8e-76034f162701', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'whats up', NULL, NULL, '2025-11-16T16:39:41.902649+00:00', '2025-11-16T16:39:41.902649+00:00', 0, 0, 0),
('35662466-2004-420b-8c3f-75f0ae7a76b4', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'hey', NULL, NULL, '2025-11-16T16:48:48.336289+00:00', '2025-11-16T16:48:48.336289+00:00', 0, 0, 1),
('f263169b-232f-45f1-804a-07a5fdd051bc', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'hey', NULL, NULL, '2025-11-16T17:15:55.509804+00:00', '2025-11-16T17:15:55.509804+00:00', 0, 0, 0),
('b3a5cab9-0e50-434f-93a9-11d7987f9f85', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Reposted from @Hoark', NULL, '35662466-2004-420b-8c3f-75f0ae7a76b4', '2025-11-16T17:24:16.827823+00:00', '2025-11-16T17:24:16.827823+00:00', 0, 0, 2),
('d452fa68-e834-47ec-9513-eb6fcdc5cbe9', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Reposted from @Hoark', NULL, 'b3a5cab9-0e50-434f-93a9-11d7987f9f85', '2025-11-18T01:54:51.606977+00:00', '2025-11-18T01:54:51.606977+00:00', 0, 0, 0),
('0809f11d-7ab1-4e34-baca-f1dfba356c25', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'Reposted from @Hoark', NULL, 'b3a5cab9-0e50-434f-93a9-11d7987f9f85', '2025-11-18T01:54:54.268337+00:00', '2025-11-18T01:54:54.268337+00:00', 1, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Insert activity_feed
INSERT INTO activity_feed (id, user_id, activity_type, title, description, metadata, is_public, created_at, likes_count, comments_count, reposts_count, shares_count) VALUES
('4bc8be8b-41d1-45f5-95de-7c9e53fe7e71', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'portfolio_created', 'Created a new portfolio', 'Started building their ultimate collection', '{"portfolio_name":"My Amazing Collection"}', true, '2025-11-11T23:59:33.090503+00:00', 1, 0, 0, 2),
('a146d635-cb4b-4d3a-a3ef-afc22976626b', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'card_added', 'Added cards to collection', 'Added several rare cards', '{"card_count":5}', true, '2025-11-11T23:59:33.090503+00:00', 0, 0, 0, 0),
('d75943e7-b545-4289-84fe-8fe4e43d694f', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'collection_milestone', 'Reached 100 unique cards', 'Major milestone achieved!', '{}', true, '2025-11-11T23:59:33.090503+00:00', 0, 0, 0, 0),
('78ea0367-f565-4e03-97e4-58b4349407c1', '2fa05548-0252-4923-863a-b54fd6aec3ee', 'collection_milestone', 'Collection value reached $1000', 'Portfolio value milestone!', '{}', true, '2025-11-11T23:59:33.090503+00:00', 0, 0, 0, 0),
('48f84d0a-92b7-46f1-a6fc-f11b82d2d8ae', '550e8400-e29b-41d4-a716-446655440000', 'user_followed', 'Started following', 'Started following another user', '{"following_id":"2fa05548-0252-4923-863a-b54fd6aec3ee"}', true, '2025-11-11T23:59:33.090503+00:00', 0, 0, 0, 0),
('5a05fa1d-550b-43fa-b86f-6588c47b5d78', '550e8400-e29b-41d4-a716-446655440000', 'group_joined', 'Joined group', 'Joined a community group', '{"group_name":"Pokemon Collectors"}', true, '2025-11-11T23:59:33.090503+00:00', 0, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Insert marketplace_listings
INSERT INTO marketplace_listings (id, seller_id, seller_username, card_id, card_name, card_image, card_set, card_number, card_rarity, condition, grade, grade_company, quantity, price, currency, listing_type, auction_end_date, starting_bid, current_bid, bid_count, description, shipping_cost, shipping_from, status, created_at, updated_at, additional_images, favorite_count, view_count) VALUES
('0841eb00-0ca0-42fd-9081-f6bce4f98c5e', '550e8400-e29b-41d4-a716-446655440000', 'PokemonMaster', 'charizard-base-set-1st-edition', '1st Edition Charizard', 'https://images.pokemontcg.io/base1/4_hires.png', 'Base Set', '4/102', 'holo', 'NM', 10, 'PSA', 1, 2500, 'USD', 'fixed_price', NULL, NULL, NULL, 0, 'Beautiful 1st Edition Charizard in PSA 10 condition. Perfect centering and corners.', 15.99, 'San Francisco, CA', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0),
('66e53a78-68fb-41e9-a1d8-35aa518980f2', '550e8400-e29b-41d4-a716-446655440000', 'PokemonMaster', 'pikachu-japanese-no-1-promotional', 'Pikachu Trophy', 'https://images.pokemontcg.io/no1/1_hires.png', 'No. 1 Trainer', '1/0', 'rare', 'NM', NULL, NULL, 1, 899.99, 'USD', 'fixed_price', NULL, NULL, NULL, 0, 'Japanese Pikachu Trophy card - extremely rare promotional item.', 12.99, 'San Francisco, CA', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0),
('03046e02-62c7-499c-9ddf-c14dd01580b4', '550e8400-e29b-41d4-a716-446655440003', 'CardTraderPro', 'charizard-shadowless', 'Shadowless Charizard', 'https://images.pokemontcg.io/base1/4_hires.png', 'Base Set', '4/102', 'holo', 'HP', NULL, NULL, 1, 125, 'USD', 'best_offer', NULL, NULL, NULL, 0, 'Shadowless Charizard in heavily played condition. Great for beginners or collections.', 5.99, 'Chicago, IL', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0),
('e5e660e0-85f5-4a49-b044-bdb97a207033', '550e8400-e29b-41d4-a716-446655440001', 'YugiohLegend', 'blue-eyes-white-dragon-legendary-collection', 'Blue-Eyes White Dragon', 'https://images.ygoprodeck.com/images/cards/89631139.jpg', 'Legendary Collection', 'LC01-EN001', 'rare', 'LP', NULL, NULL, 1, 45.99, 'USD', 'fixed_price', NULL, NULL, NULL, 0, 'Classic Blue-Eyes White Dragon card in lightly played condition.', 3.99, 'New York, NY', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0),
('9a71ef0d-2138-46b5-b207-c29208e16789', '550e8400-e29b-41d4-a716-446655440001', 'YugiohLegend', 'dark-magician-girl-premium-gold', 'Dark Magician Girl', 'https://images.ygoprodeck.com/images/cards/38033121.jpg', 'Premium Gold', 'PGLD-EN001', 'gold_rare', 'NM', NULL, NULL, 1, 75.5, 'USD', 'fixed_price', NULL, NULL, NULL, 0, 'Beautiful Dark Magician Girl Premium Gold Rare in near mint condition.', 4.99, 'New York, NY', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0),
('25b554b1-ee22-4edf-9b3a-144eafd1656a', '550e8400-e29b-41d4-a716-446655440004', 'VintageTrader', 'exodia-the-forbidden-one-dark-beginning-1st-edition', 'Exodia the Forbidden One', 'https://images.ygoprodeck.com/images/cards/33396948.jpg', 'Dark Beginning 1', 'DB1-EN001', 'ultra_rare', 'NM', NULL, NULL, 1, 299.99, 'USD', 'auction', '2025-11-20T23:59:59+00:00', 250, 250, 0, '1st Edition Exodia the Forbidden One from Dark Beginning. Rare and valuable piece.', 8.99, 'Seattle, WA', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0),
('355e7e5b-4cb1-4c40-bb51-084c6c485b80', '550e8400-e29b-41d4-a716-446655440002', 'MagicCollector', 'black-lotus-alpha-edition', 'Black Lotus', 'https://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=382866&type=card', 'Alpha Edition', '1', 'rare', 'MP', NULL, NULL, 1, 18500, 'USD', 'auction', '2025-12-13T23:59:59+00:00', 15000, 15000, 0, 'Extremely rare Alpha Edition Black Lotus. One of the most valuable Magic cards ever printed.', 25, 'Los Angeles, CA', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0),
('a5ff6352-7eda-4654-b500-d6d27b08610e', '550e8400-e29b-41d4-a716-446655440002', 'MagicCollector', 'ancestral-recall-beta-edition', 'Ancestral Recall', 'https://gatherer.wizards.com/Handlers/Image.ashx?multiverseid=382867&type=card', 'Beta Edition', '1', 'rare', 'LP', NULL, NULL, 1, 3200, 'USD', 'fixed_price', NULL, NULL, NULL, 0, 'Beta Edition Ancestral Recall - one of the most powerful cards in Magic history.', 18.99, 'Los Angeles, CA', 'active', '2025-11-13T01:32:48.430509+00:00', '2025-11-13T01:32:48.430509+00:00', '{}', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Insert leaderboards
INSERT INTO leaderboards (id, user_id, category, score, rank, previous_rank, last_updated) VALUES
('d39e9918-f772-4dd2-b195-6f8f0258776c', '550e8400-e29b-41d4-a716-446655440000', 'collection_value', 5000, 1, NULL, '2025-11-18T04:44:51.053671+00:00')
ON CONFLICT (id) DO NOTHING;

-- Insert user_liked_activities
INSERT INTO user_liked_activities (user_id, activity_id, created_at) VALUES
('2fa05548-0252-4923-863a-b54fd6aec3ee', '4bc8be8b-41d1-45f5-95de-7c9e53fe7e71', '2025-11-24T16:47:58.319799+00:00')
ON CONFLICT (user_id, activity_id) DO NOTHING;

-- Insert user_liked_posts
INSERT INTO user_liked_posts (user_id, post_id, created_at) VALUES
('2fa05548-0252-4923-863a-b54fd6aec3ee', '0809f11d-7ab1-4e34-baca-f1dfba356c25', '2025-11-24T16:21:47.536939+00:00')
ON CONFLICT (user_id, post_id) DO NOTHING;

-- Insert collection_value_history
INSERT INTO collection_value_history (id, user_id, total_value, total_cards, unique_cards, premium_cards, snapshot_date, created_at, updated_at) VALUES
('dc6f45a7-4de1-425d-9dc7-96ccdf3f43df', '2fa05548-0252-4923-863a-b54fd6aec3ee', 200.17, 13, 7, 4, '2025-11-16', '2025-11-16T00:21:50.092923+00:00', '2025-11-16T23:05:42.215543+00:00'),
('f9e80775-73ec-431f-871d-02564f2b6811', '2fa05548-0252-4923-863a-b54fd6aec3ee', 202.16, 13, 7, 1, '2025-11-12', '2025-11-12T01:48:38.248245+00:00', '2025-11-12T22:11:10.174756+00:00'),
('aba8f97d-7c87-4ef3-9e2c-e52b4c07f515', '2fa05548-0252-4923-863a-b54fd6aec3ee', 504.27, 21, 7, 4, '2025-11-24', '2025-11-24T00:59:23.027547+00:00', '2025-11-24T21:41:42.117519+00:00'),
('b5811f9b-a486-40b2-aa73-2830dfab8a52', '2fa05548-0252-4923-863a-b54fd6aec3ee', 504.41, 22, 10, 2, '2025-11-25', '2025-11-25T04:21:43.700041+00:00', '2025-11-25T04:21:43.700041+00:00'),
('a9b2cdaa-9d13-4f4c-a1db-4291ae39d587', '2fa05548-0252-4923-863a-b54fd6aec3ee', 202.16, 13, 7, 4, '2025-11-15', '2025-11-15T13:43:13.896024+00:00', '2025-11-15T22:40:40.343968+00:00'),
('817c801a-c08a-438b-b351-8a30a308ec3c', '2fa05548-0252-4923-863a-b54fd6aec3ee', 202.16, 13, 7, 1, '2025-11-13', '2025-11-13T03:03:23.376217+00:00', '2025-11-13T21:52:58.536746+00:00'),
('5af79c45-2d2a-43d0-8d0b-7bb9d08808c9', '2fa05548-0252-4923-863a-b54fd6aec3ee', 200.17, 13, 7, 4, '2025-11-17', '2025-11-17T01:07:59.957656+00:00', '2025-11-17T23:59:55.967118+00:00'),
('892f3011-6cbb-4f30-a704-14a94dab203e', '2fa05548-0252-4923-863a-b54fd6aec3ee', 200.17, 13, 7, 4, '2025-11-18', '2025-11-18T01:00:57.987097+00:00', '2025-11-18T04:36:12.457654+00:00'),
('99b44f28-c241-4ae3-9163-2081062333ea', '2fa05548-0252-4923-863a-b54fd6aec3ee', 48.77, 9, 4, 0, '2025-10-11', '2025-11-11T17:17:35.720982+00:00', '2025-11-11T20:21:21.618582+00:00'),
('a3d0c98d-6854-44ea-b49e-56223e4f2474', '2fa05548-0252-4923-863a-b54fd6aec3ee', 200.17, 13, 7, 4, '2025-11-19', '2025-11-19T05:08:05.119375+00:00', '2025-11-19T05:08:05.119375+00:00'),
('f89f81c3-095f-4262-93e1-6b9e8a88c689', '2fa05548-0252-4923-863a-b54fd6aec3ee', 200.17, 13, 7, 4, '2025-11-20', '2025-11-20T22:44:38.861121+00:00', '2025-11-20T22:48:33.07634+00:00'),
('143304b6-ab89-4aa1-85d7-e3dc901be17d', '2fa05548-0252-4923-863a-b54fd6aec3ee', 202.16, 13, 7, 4, '2025-11-14', '2025-11-14T02:22:42.277073+00:00', '2025-11-14T20:17:52.546093+00:00'),
('a39942c5-d97d-4405-9842-dc0ea4f6dbb3', '2fa05548-0252-4923-863a-b54fd6aec3ee', 200.17, 13, 7, 1, '2025-11-23', '2025-11-23T20:59:23.062902+00:00', '2025-11-23T20:59:23.062902+00:00'),
('6ef08b3d-0d3e-442b-9994-d4fa2d57fd09', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.9, 9, 4, 0, '2025-10-12', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('a83480c2-40be-443b-ae00-602dd256a566', '2fa05548-0252-4923-863a-b54fd6aec3ee', 14.08, 9, 4, 0, '2025-10-13', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('485ce517-ce4f-4b9d-b056-f9e5493f855c', '2fa05548-0252-4923-863a-b54fd6aec3ee', 14.02, 9, 4, 0, '2025-10-14', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('0ebd8bf5-e478-47ad-ad87-0b7002b7e036', '2fa05548-0252-4923-863a-b54fd6aec3ee', 14.02, 9, 4, 0, '2025-10-15', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('44632102-0271-40f9-a951-cd44febc2213', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.84, 9, 4, 0, '2025-10-16', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('7508b037-303d-411c-aaec-db452355a935', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.74, 9, 4, 0, '2025-10-17', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('4f9cee09-d375-447d-ba36-e76c076f796b', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.3, 9, 4, 0, '2025-10-18', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('0746e767-da8c-435b-940e-ce60a38d299f', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.3, 9, 4, 0, '2025-10-19', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('bc2291dd-19f2-49fc-b984-0739f28cbda0', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.3, 9, 4, 0, '2025-10-20', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('4586dc22-09bb-4d5a-8b7b-cc183f1e1fba', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.3, 9, 4, 0, '2025-10-21', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('d726ac22-36d6-4cbf-a14f-498624bf0c47', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.06, 9, 4, 0, '2025-10-22', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('29afde4e-5346-4c78-88ca-ee8468ba78c0', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.08, 9, 4, 0, '2025-10-23', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('28573a7e-93f0-4786-9e6b-31f7e3987b87', '2fa05548-0252-4923-863a-b54fd6aec3ee', 13.08, 9, 4, 0, '2025-10-24', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('29992f95-682d-4052-94ca-824e2f4ed10d', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.98, 9, 4, 0, '2025-10-25', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('20c190a2-90b6-4612-b7e8-b8fcc41656e7', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.98, 9, 4, 0, '2025-10-26', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('83fcacac-d685-464c-9a95-964222003adf', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.86, 9, 4, 0, '2025-10-27', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('a2a77dbf-2540-4d6b-8834-726ce77854b0', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.86, 9, 4, 0, '2025-10-28', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('c246a271-c319-4b15-aee9-eec328833704', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.58, 9, 4, 0, '2025-10-29', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('5e77c062-0d3e-4ea4-ad11-612f922c15eb', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.42, 9, 4, 0, '2025-10-30', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('98f5a1f5-09d4-458e-8864-6b723211a5d6', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.42, 9, 4, 0, '2025-10-31', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('34ddd5ba-6dcf-4aa8-a9bc-381df394b8a7', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.54, 9, 4, 0, '2025-11-01', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('adbbffcd-ff9f-40a4-b474-3dfbb8ae1019', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.54, 9, 4, 0, '2025-11-02', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('13f2e461-5576-4a90-a0a1-7ebf59b94431', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.5, 9, 4, 0, '2025-11-03', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('d8094c58-fb68-4c6d-9fcb-843140b2061f', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.5, 9, 4, 0, '2025-11-04', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('4204b8f5-d0b2-45a8-a5d1-ec6a8774dd71', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.4, 9, 4, 0, '2025-11-05', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('53a3699b-87b6-4685-a3e9-ad6101bbbd5c', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.28, 9, 4, 0, '2025-11-06', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('394ea727-3015-4ed0-938d-84eb568fe638', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.1, 9, 4, 0, '2025-11-07', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('6a3edfb9-3c63-47ee-ae8f-c72d6adc0764', '2fa05548-0252-4923-863a-b54fd6aec3ee', 12.26, 9, 4, 0, '2025-11-08', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('3d400246-feb6-4993-9f8f-38a14d65f603', '2fa05548-0252-4923-863a-b54fd6aec3ee', 11.88, 9, 4, 0, '2025-11-09', '2025-11-11T20:42:26.430563+00:00', '2025-11-11T20:42:26.430563+00:00'),
('0bc90230-ec2b-4971-94ee-1a765b362570', '2fa05548-0252-4923-863a-b54fd6aec3ee', 48.77, 9, 4, 0, '2025-11-11', '2025-11-11T20:42:26.56005+00:00', '2025-11-11T20:42:26.56005+00:00')
ON CONFLICT (id) DO NOTHING;

-- Grant permissions again after data insert
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
