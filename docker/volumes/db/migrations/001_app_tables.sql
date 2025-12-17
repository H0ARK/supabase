-- App Tables Migration from Supabase Cloud
-- Generated: 2025-11-25

-- Create custom types
DO $$ BEGIN
    CREATE TYPE price_alert_direction AS ENUM ('above', 'below');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Enable uuid-ossp extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PROFILES
CREATE TABLE IF NOT EXISTS profiles (
    id uuid PRIMARY KEY,
    username text UNIQUE,
    avatar_url text,
    bio text,
    followers_count integer DEFAULT 0,
    following_count integer DEFAULT 0,
    collection_value numeric DEFAULT 0,
    total_cards integer DEFAULT 0,
    portfolios_count integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- PORTFOLIOS
CREATE TABLE IF NOT EXISTS portfolios (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_default boolean DEFAULT false,
    is_public boolean DEFAULT false,
    display_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, name)
);

-- USER_COLLECTIONS
CREATE TABLE IF NOT EXISTS user_collections (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    tcgdex_card_id text,
    quantity integer DEFAULT 1,
    condition text,
    acquired_date date,
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    portfolio_id uuid,
    tcgplayer_product_id integer,
    rarity text,
    card_variant_id integer NOT NULL
);

-- USER_SETTINGS
CREATE TABLE IF NOT EXISTS user_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL UNIQUE,
    notifications_email boolean NOT NULL DEFAULT true,
    notifications_push boolean NOT NULL DEFAULT true,
    notifications_price_alerts boolean NOT NULL DEFAULT false,
    notifications_new_followers boolean NOT NULL DEFAULT true,
    notifications_trades boolean NOT NULL DEFAULT true,
    privacy_profile_public boolean NOT NULL DEFAULT true,
    privacy_show_collection boolean NOT NULL DEFAULT true,
    privacy_show_activity boolean NOT NULL DEFAULT false,
    appearance_accent_color text,
    appearance_theme text NOT NULL DEFAULT 'dark',
    preferences_default_view text NOT NULL DEFAULT 'grid',
    preferences_currency text NOT NULL DEFAULT 'USD',
    preferences_language text NOT NULL DEFAULT 'en',
    notifications_marketing boolean NOT NULL DEFAULT false,
    notifications_weekly_digest boolean NOT NULL DEFAULT false,
    security_two_factor_enabled boolean NOT NULL DEFAULT false,
    security_two_factor_method text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- USER_FOLLOWS
CREATE TABLE IF NOT EXISTS user_follows (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id uuid NOT NULL,
    following_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE(follower_id, following_id)
);

-- USER_GROUPS
CREATE TABLE IF NOT EXISTS user_groups (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name text NOT NULL,
    description text,
    avatar_url text,
    banner_url text,
    created_by uuid NOT NULL,
    is_private boolean DEFAULT false,
    member_count integer DEFAULT 1,
    category text,
    rules text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- GROUP_MEMBERS
CREATE TABLE IF NOT EXISTS group_members (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member',
    joined_at timestamptz DEFAULT now(),
    UNIQUE(group_id, user_id)
);

-- GROUP_POSTS
CREATE TABLE IF NOT EXISTS group_posts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id uuid NOT NULL,
    author_id uuid NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    is_pinned boolean DEFAULT false,
    is_locked boolean DEFAULT false,
    reply_count integer DEFAULT 0,
    last_reply_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- GROUP_POST_REPLIES
CREATE TABLE IF NOT EXISTS group_post_replies (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id uuid NOT NULL,
    author_id uuid NOT NULL,
    parent_reply_id uuid,
    content text NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- POSTS
CREATE TABLE IF NOT EXISTS posts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    content text NOT NULL,
    parent_post_id uuid,
    repost_of_id uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    likes_count integer DEFAULT 0,
    replies_count integer DEFAULT 0,
    reposts_count integer DEFAULT 0
);

-- POST_LIKES
CREATE TABLE IF NOT EXISTS post_likes (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE(post_id, user_id)
);

-- POST_HASHTAGS
CREATE TABLE IF NOT EXISTS post_hashtags (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id uuid NOT NULL,
    hashtag_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE(post_id, hashtag_id)
);

-- POST_MENTIONS
CREATE TABLE IF NOT EXISTS post_mentions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id uuid NOT NULL,
    mentioned_user_id uuid NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- HASHTAGS
CREATE TABLE IF NOT EXISTS hashtags (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now()
);

-- ACTIVITY_FEED
CREATE TABLE IF NOT EXISTS activity_feed (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    activity_type text NOT NULL,
    title text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_public boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    likes_count integer DEFAULT 0,
    comments_count integer DEFAULT 0,
    reposts_count integer DEFAULT 0,
    shares_count integer DEFAULT 0
);

-- ACTIVITY_COMMENTS
CREATE TABLE IF NOT EXISTS activity_comments (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- ACTIVITY_LIKES
CREATE TABLE IF NOT EXISTS activity_likes (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE(activity_id, user_id)
);

-- ACTIVITY_REPOSTS
CREATE TABLE IF NOT EXISTS activity_reposts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE(activity_id, user_id)
);

-- ACTIVITY_SHARES
CREATE TABLE IF NOT EXISTS activity_shares (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- USER_LIKED_ACTIVITIES
CREATE TABLE IF NOT EXISTS user_liked_activities (
    user_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, activity_id)
);

-- USER_LIKED_POSTS
CREATE TABLE IF NOT EXISTS user_liked_posts (
    user_id uuid NOT NULL,
    post_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

-- COLLECTION_VALUE_HISTORY
CREATE TABLE IF NOT EXISTS collection_value_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    total_value numeric(10,2) NOT NULL DEFAULT 0,
    total_cards integer NOT NULL DEFAULT 0,
    unique_cards integer NOT NULL DEFAULT 0,
    premium_cards integer NOT NULL DEFAULT 0,
    snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id, snapshot_date)
);

-- LEADERBOARDS
CREATE TABLE IF NOT EXISTS leaderboards (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    category text NOT NULL,
    score numeric(15,2) NOT NULL DEFAULT 0,
    rank integer,
    previous_rank integer,
    last_updated timestamptz DEFAULT now(),
    UNIQUE(user_id, category)
);

-- MARKETPLACE_LISTINGS
CREATE TABLE IF NOT EXISTS marketplace_listings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id uuid NOT NULL,
    seller_username text NOT NULL,
    card_id text NOT NULL,
    card_name text NOT NULL,
    card_image text NOT NULL,
    card_set text NOT NULL,
    card_number text NOT NULL,
    card_rarity text NOT NULL,
    condition text NOT NULL,
    grade integer,
    grade_company text,
    quantity integer DEFAULT 1,
    price numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD',
    listing_type text NOT NULL,
    auction_end_date timestamptz,
    starting_bid numeric(10,2),
    current_bid numeric(10,2),
    bid_count integer DEFAULT 0,
    description text,
    shipping_cost numeric(10,2) DEFAULT 0.00,
    shipping_from text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    additional_images text[] DEFAULT '{}',
    favorite_count integer DEFAULT 0,
    view_count integer DEFAULT 0
);

-- MARKETPLACE_BIDS
CREATE TABLE IF NOT EXISTS marketplace_bids (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id uuid NOT NULL,
    bidder_id uuid NOT NULL,
    bidder_username text NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD',
    created_at timestamptz DEFAULT now()
);

-- MARKETPLACE_OFFERS
CREATE TABLE IF NOT EXISTS marketplace_offers (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD',
    message text,
    status text NOT NULL DEFAULT 'pending',
    counter_amount numeric(10,2),
    counter_message text,
    countered_at timestamptz,
    resolved_at timestamptz,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- MARKETPLACE_PURCHASES
CREATE TABLE IF NOT EXISTS marketplace_purchases (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id uuid,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD',
    platform_fee numeric(10,2) NOT NULL,
    stripe_payment_intent_id text UNIQUE,
    status text NOT NULL DEFAULT 'pending',
    shipping_name text,
    shipping_address text,
    shipping_city text,
    shipping_state text,
    shipping_zip_code text,
    shipping_country text,
    tracking_number text,
    created_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    shipped_at timestamptz
);

-- MARKETPLACE_DISPUTES
CREATE TABLE IF NOT EXISTS marketplace_disputes (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    listing_id uuid,
    reason text NOT NULL,
    description text NOT NULL,
    evidence jsonb,
    status text NOT NULL DEFAULT 'open',
    resolution text,
    refund_amount numeric(10,2),
    admin_notes text,
    created_at timestamptz DEFAULT now(),
    resolved_at timestamptz,
    buyer_username text,
    seller_username text,
    listing_name text,
    listing_image text,
    order_amount numeric(10,2),
    seller_response text,
    seller_evidence jsonb DEFAULT '[]'::jsonb,
    seller_proposed_resolution text,
    seller_proposed_refund_amount numeric(10,2),
    seller_responded_at timestamptz,
    admin_public_notes text,
    assigned_admin_id uuid,
    timeline_events jsonb DEFAULT '[]'::jsonb,
    stripe_refund_id text,
    refund_processed_at timestamptz,
    updated_at timestamptz DEFAULT now()
);

-- DISPUTE_RESPONSES
CREATE TABLE IF NOT EXISTS dispute_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id uuid NOT NULL,
    user_id uuid NOT NULL,
    user_role text NOT NULL,
    message text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    is_internal boolean DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- DISPUTE_TIMELINE
CREATE TABLE IF NOT EXISTS dispute_timeline (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_id uuid,
    actor_role text,
    description text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- USER_FAVORITES
CREATE TABLE IF NOT EXISTS user_favorites (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    listing_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, listing_id)
);

-- USER_NOTIFICATIONS
CREATE TABLE IF NOT EXISTS user_notifications (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    type text NOT NULL,
    triggered_by_user_id uuid NOT NULL,
    post_id uuid,
    read_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- PRICE_ALERTS
CREATE TABLE IF NOT EXISTS price_alerts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    card_id text NOT NULL,
    card_name text NOT NULL,
    card_image text,
    target_price numeric(10,2) NOT NULL,
    current_price numeric(10,2),
    notified boolean NOT NULL DEFAULT false,
    notified_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, card_id)
);

-- USER_PRICE_ALERTS
CREATE TABLE IF NOT EXISTS user_price_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid,
    tcgplayer_product_id text NOT NULL,
    direction price_alert_direction NOT NULL,
    threshold numeric NOT NULL,
    is_active boolean DEFAULT true,
    last_triggered_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- SELLER_ACCOUNTS
CREATE TABLE IF NOT EXISTS seller_accounts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL UNIQUE,
    stripe_account_id text UNIQUE,
    onboarding_complete boolean DEFAULT false,
    charges_enabled boolean DEFAULT false,
    payouts_enabled boolean DEFAULT false,
    verification_status text DEFAULT 'unverified',
    business_name text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- SELLER_REVIEWS
CREATE TABLE IF NOT EXISTS seller_reviews (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    purchase_id uuid NOT NULL UNIQUE,
    rating integer NOT NULL,
    comment text,
    created_at timestamptz DEFAULT now(),
    buyer_username text
);

-- SAVED_SEARCHES
CREATE TABLE IF NOT EXISTS saved_searches (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    name text NOT NULL,
    filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_used_at timestamptz,
    use_count integer DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- CONVERSATIONS
CREATE TABLE IF NOT EXISTS conversations (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_type text NOT NULL,
    title text,
    description text,
    avatar_url text,
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- CONVERSATION_PARTICIPANTS
CREATE TABLE IF NOT EXISTS conversation_participants (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member',
    joined_at timestamptz DEFAULT now(),
    UNIQUE(conversation_id, user_id)
);

-- MESSAGES
CREATE TABLE IF NOT EXISTS messages (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    sender_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    subject text NOT NULL,
    content text NOT NULL,
    read_at timestamptz,
    created_at timestamptz DEFAULT now(),
    conversation_id uuid,
    message_type text DEFAULT 'text',
    is_deleted boolean DEFAULT false
);

-- CARD_ID_MAPPINGS
CREATE TABLE IF NOT EXISTS card_id_mappings (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tcgdex_card_id text NOT NULL UNIQUE,
    tcgplayer_product_id integer NOT NULL,
    card_name text,
    set_id text,
    verified boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- USER_COLLECTIONS_BACKUP
CREATE TABLE IF NOT EXISTS user_collections_backup (
    id uuid,
    user_id uuid,
    tcgdex_card_id text,
    quantity integer,
    condition text,
    acquired_date date,
    notes text,
    created_at timestamptz,
    updated_at timestamptz,
    portfolio_id uuid
);

-- Grant permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
