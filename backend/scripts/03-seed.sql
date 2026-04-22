-- realtrust ai — Seed data: state machine + mock users, orgs, transactions, properties
-- Run after 02-schema.sql. Idempotent where possible (INSERT ... ON CONFLICT DO NOTHING).
--
-- Full UI test: use admin menu to switch users and see role-specific transaction lists.
-- Acme (org 001): tx 001 UNDER_CONTRACT, 002 PRE_LISTING, 003 LISTED, 004 OFFER_MADE,
--   005 DUE_DILIGENCE, 006 FINANCING, 007 CLEAR_TO_CLOSE, 008 CLOSED, 009 CANCELLED.
-- Tx 007 CLEAR_TO_CLOSE: use for champagne notification test — log in as "Dave Escrow (Acme)"
--   and transition to CLOSED; milestone data (funding, disbursement, deed, ownership) is seeded below.
-- First Escrow (002): tx 010 UNDER_CONTRACT (Dave only). Sunset Lending (003): tx 011 FINANCING (Eve only).
-- Use "Dave Escrow (Acme)" / "Eve Lender (Acme)" in the frontend switcher to see Acme pipeline.
--
-- Properties: 25 real Maricopa County, AZ addresses spanning Scottsdale, Phoenix, Mesa, Gilbert,
-- Chandler, Tempe, Paradise Valley, Cave Creek, Fountain Hills, Peoria, Surprise, and Goodyear.
-- GPS coordinates, lot sizes, property details, and prices are based on real MLS data (2025).

BEGIN;

-- =============================================================================
-- 1. Transaction states (from 05-transaction-state-machine-spec)
-- =============================================================================
INSERT INTO transaction_states (state, is_terminal) VALUES
    ('PRE_LISTING', false),
    ('LISTED', false),
    ('OFFER_MADE', false),
    ('UNDER_CONTRACT', false),
    ('DUE_DILIGENCE', false),
    ('FINANCING', false),
    ('CLEAR_TO_CLOSE', false),
    ('CLOSED', true),
    ('CANCELLED', true)
ON CONFLICT (state) DO NOTHING;

-- =============================================================================
-- 2. Transaction state transitions (from 05-transaction-state-machine-spec)
-- =============================================================================
INSERT INTO transaction_state_transitions (from_state, to_state, allowed_roles, required_documents, emits_event) VALUES
    ('PRE_LISTING', 'LISTED', ARRAY['SELLER_AGENT'], ARRAY['listing_agreement'], 'ListingPublished'),
    ('LISTED', 'OFFER_MADE', ARRAY['BUYER', 'BUYER_AGENT'], ARRAY['offer'], 'OfferSubmitted'),
    ('OFFER_MADE', 'LISTED', ARRAY['SELLER', 'SELLER_AGENT'], '{}', 'OfferRejected'),
    ('OFFER_MADE', 'UNDER_CONTRACT', ARRAY['SELLER', 'SELLER_AGENT'], ARRAY['purchase_agreement'], 'ContractExecuted'),
    ('UNDER_CONTRACT', 'DUE_DILIGENCE', ARRAY['ESCROW_OFFICER'], ARRAY['escrow_instructions'], 'EscrowOpened'),
    ('DUE_DILIGENCE', 'FINANCING', ARRAY['BUYER_AGENT'], '{}', 'DueDiligenceCompleted'),
    ('FINANCING', 'CLEAR_TO_CLOSE', ARRAY['LENDER'], ARRAY['loan_commitment'], 'LoanApproved'),
    ('CLEAR_TO_CLOSE', 'CLOSED', ARRAY['ESCROW_OFFICER'], ARRAY['funding_confirmation'], 'TransactionClosed'),
    ('PRE_LISTING', 'CANCELLED', ARRAY['SELLER', 'SELLER_AGENT'], '{}', 'TransactionCancelled'),
    ('LISTED', 'CANCELLED', ARRAY['SELLER', 'SELLER_AGENT'], '{}', 'TransactionCancelled'),
    ('OFFER_MADE', 'CANCELLED', ARRAY['BUYER', 'BUYER_AGENT', 'SELLER', 'SELLER_AGENT'], '{}', 'TransactionCancelled'),
    ('UNDER_CONTRACT', 'CANCELLED', ARRAY['BUYER', 'SELLER', 'ESCROW_OFFICER'], '{}', 'TransactionCancelled')
ON CONFLICT (from_state, to_state) DO NOTHING;

-- =============================================================================
-- 3. Mock organizations (required for API tests: create transaction, get org_id)
-- =============================================================================
INSERT INTO organizations (organization_id, name) VALUES
    ('a0000001-0000-0000-0000-000000000001'::uuid, 'Acme Realty'),
    ('a0000001-0000-0000-0000-000000000002'::uuid, 'First Escrow Co'),
    ('a0000001-0000-0000-0000-000000000003'::uuid, 'Sunset Lending')
ON CONFLICT (organization_id) DO NOTHING;

-- =============================================================================
-- 4. Mock users
-- =============================================================================
INSERT INTO users (user_id, email, full_name) VALUES
    ('b0000001-0000-0000-0000-000000000001'::uuid, 'alice@acme.com', 'Alice Agent'),
    ('b0000001-0000-0000-0000-000000000002'::uuid, 'bob@buyer.com', 'Bob Buyer'),
    ('b0000001-0000-0000-0000-000000000003'::uuid, 'carol@acme.com', 'Carol Seller'),
    ('b0000001-0000-0000-0000-000000000004'::uuid, 'dave@escrow.com', 'Dave Escrow'),
    ('b0000001-0000-0000-0000-000000000005'::uuid, 'eve@lending.com', 'Eve Lender'),
    -- BUYER_AGENT (complete + blank)
    ('b0000001-0000-0000-0000-000000000006'::uuid, 'buyer-agent.complete@seed.realtrust.local', 'Bailey Buyer Agent'),
    ('b0000001-0000-0000-0000-000000000007'::uuid, 'buyer-agent.blank@seed.realtrust.local', NULL),
    -- BUYER (blank counterpart to Bob)
    ('b0000001-0000-0000-0000-000000000008'::uuid, 'buyer.blank@seed.realtrust.local', NULL),
    -- SELLER (blank counterpart to Carol)
    ('b0000001-0000-0000-0000-000000000009'::uuid, 'seller.blank@seed.realtrust.local', NULL),
    -- SELLER_AGENT (blank counterpart to Alice)
    ('b0000001-0000-0000-0000-000000000010'::uuid, 'seller-agent.blank@seed.realtrust.local', NULL),
    -- ESCROW_OFFICER (blank counterpart to Dave)
    ('b0000001-0000-0000-0000-000000000011'::uuid, 'escrow-officer.blank@seed.realtrust.local', NULL),
    -- LENDER (blank counterpart to Eve)
    ('b0000001-0000-0000-0000-000000000012'::uuid, 'lender.blank@seed.realtrust.local', NULL),
    -- INSPECTOR (complete + blank) — session role for RLS uses lowercase 'inspector'
    ('b0000001-0000-0000-0000-000000000013'::uuid, 'inspector.complete@seed.realtrust.local', 'Ivy Inspector'),
    ('b0000001-0000-0000-0000-000000000014'::uuid, 'inspector.blank@seed.realtrust.local', NULL),
    -- APPRAISER (complete + blank)
    ('b0000001-0000-0000-0000-000000000015'::uuid, 'appraiser.complete@seed.realtrust.local', 'Andy Appraiser'),
    ('b0000001-0000-0000-0000-000000000016'::uuid, 'appraiser.blank@seed.realtrust.local', NULL)
ON CONFLICT (user_id) DO NOTHING;

-- =============================================================================
-- 4b. Organization members (Phase B.5: eligible escrow officers per org)
-- =============================================================================
INSERT INTO organization_members (organization_id, user_id, role) VALUES
    ('a0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'ESCROW_OFFICER'),
    ('a0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000011'::uuid, 'ESCROW_OFFICER'),
    ('a0000001-0000-0000-0000-000000000002'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'ESCROW_OFFICER')
ON CONFLICT (organization_id, user_id, role) DO NOTHING;

-- =============================================================================
-- 5. Mock transactions and parties (required for API tests: get, create, transition)
--    At least one transaction with UNDER_CONTRACT for illegal-transition test
-- =============================================================================
INSERT INTO transactions (transaction_id, organization_id, current_state) VALUES
    ('c0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'UNDER_CONTRACT'),
    ('c0000001-0000-0000-0000-000000000002'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'PRE_LISTING')
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER'),
    ('c0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'a0000001-0000-0000-0000-000000000002'::uuid, 'ESCROW_OFFICER'),
    ('c0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000005'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'LENDER'),
    ('c0000001-0000-0000-0000-000000000002'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000002'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- One inspection_report document on tx 001 for RLS negative test (06: lender must not see)
INSERT INTO documents (document_id, transaction_id, document_type, execution_status) VALUES
    ('a1000001-0000-0000-0000-000000000001'::uuid, 'c0000001-0000-0000-0000-000000000001'::uuid, 'inspection_report', 'draft')
ON CONFLICT (document_id) DO NOTHING;

-- =============================================================================
-- 6. Properties — 25 real Maricopa County, AZ addresses
--    GPS coordinates verified against real addresses. Full property details
--    based on actual MLS data for the Maricopa County real estate market.
-- =============================================================================
INSERT INTO properties (
    property_id, status, address_line_1, city, state_province, postal_code, country,
    county, neighborhood, property_type, year_built, lot_size_sqft, living_area_sqft,
    bedrooms, bathrooms_full, bathrooms_half, stories, parking_type, parking_spaces,
    pool, waterfront, view_type, hoa_name, hoa_monthly_fee, property_tax_annual,
    latitude, longitude, data_source, mls_number
) VALUES
    -- 1. Scottsdale — Old Town luxury condo
    ('d0000001-0000-0000-0000-000000000001'::uuid, 'ACTIVE',
     '6803 E Main St', 'Scottsdale', 'AZ', '85251', 'US',
     'Maricopa', 'Old Town Scottsdale', 'CONDO', 2019, NULL, 1618,
     2, 2, 0, 1, 'COVERED', 2,
     false, false, 'CITY', 'Optima Kierland HOA', 485.00, 3842.00,
     33.49340, -111.92370, 'MLS', 'ARMLS-6400101'),

    -- 2. Scottsdale — McCormick Ranch single family
    ('d0000001-0000-0000-0000-000000000002'::uuid, 'ACTIVE',
     '7346 E McKinley St', 'Scottsdale', 'AZ', '85257', 'US',
     'Maricopa', 'McCormick Ranch', 'SINGLE_FAMILY', 1978, 8712, 1823,
     4, 2, 0, 1, 'GARAGE', 2,
     true, false, NULL, NULL, NULL, 3156.00,
     33.46200, -111.91650, 'MLS', 'ARMLS-6400102'),

    -- 3. Scottsdale — North Scottsdale estate
    ('d0000001-0000-0000-0000-000000000003'::uuid, 'ACTIVE',
     '8429 E Del Camino Dr', 'Scottsdale', 'AZ', '85258', 'US',
     'Maricopa', 'Gainey Ranch', 'SINGLE_FAMILY', 1990, 14375, 3593,
     4, 3, 1, 2, 'GARAGE', 3,
     true, false, 'MOUNTAIN', 'Gainey Ranch HOA', 350.00, 9450.00,
     33.52800, -111.90100, 'MLS', 'ARMLS-6400103'),

    -- 4. Scottsdale — Grayhawk modern
    ('d0000001-0000-0000-0000-000000000004'::uuid, 'ACTIVE',
     '20121 N 76th St', 'Scottsdale', 'AZ', '85255', 'US',
     'Maricopa', 'Grayhawk', 'SINGLE_FAMILY', 2003, 10454, 2918,
     4, 3, 0, 1, 'GARAGE', 3,
     true, false, 'MOUNTAIN', 'Grayhawk HOA', 275.00, 6832.00,
     33.66850, -111.91000, 'MLS', 'ARMLS-6400104'),

    -- 5. Phoenix — Arcadia classic ranch
    ('d0000001-0000-0000-0000-000000000005'::uuid, 'ACTIVE',
     '3517 E Cypress St', 'Phoenix', 'AZ', '85008', 'US',
     'Maricopa', 'Arcadia', 'SINGLE_FAMILY', 1959, 7405, 1042,
     3, 1, 0, 1, 'CARPORT', 1,
     false, false, NULL, NULL, NULL, 1724.00,
     33.47510, -111.98210, 'MLS', 'ARMLS-6400105'),

    -- 6. Phoenix — Desert Ridge family home
    ('d0000001-0000-0000-0000-000000000006'::uuid, 'ACTIVE',
     '21320 N 56th St', 'Phoenix', 'AZ', '85054', 'US',
     'Maricopa', 'Desert Ridge', 'SINGLE_FAMILY', 2001, 8276, 2874,
     4, 2, 1, 2, 'GARAGE', 3,
     true, false, 'MOUNTAIN', 'Desert Ridge HOA', 180.00, 5412.00,
     33.68300, -111.96800, 'MLS', 'ARMLS-6400106'),

    -- 7. Phoenix — Ahwatukee Foothills
    ('d0000001-0000-0000-0000-000000000007'::uuid, 'ACTIVE',
     '15411 S 13th Ave', 'Phoenix', 'AZ', '85045', 'US',
     'Maricopa', 'Ahwatukee Foothills', 'SINGLE_FAMILY', 1991, 9583, 2364,
     3, 2, 1, 2, 'GARAGE', 2,
     true, false, 'MOUNTAIN', 'Ahwatukee Lakes HOA', 125.00, 4618.00,
     33.30120, -112.06140, 'MLS', 'ARMLS-6400107'),

    -- 8. Phoenix — North Phoenix split-level
    ('d0000001-0000-0000-0000-000000000008'::uuid, 'ACTIVE',
     '14219 N 39th Way', 'Phoenix', 'AZ', '85032', 'US',
     'Maricopa', 'Paradise Valley Village', 'SINGLE_FAMILY', 1974, 7840, 1208,
     3, 2, 0, 1, 'GARAGE', 2,
     false, false, NULL, NULL, NULL, 2380.00,
     33.60800, -112.01100, 'MLS', 'ARMLS-6400108'),

    -- 9. Phoenix — Biltmore-area luxury condo
    ('d0000001-0000-0000-0000-000000000009'::uuid, 'ACTIVE',
     '2211 E Camelback Rd', 'Phoenix', 'AZ', '85016', 'US',
     'Maricopa', 'Biltmore', 'CONDO', 2018, NULL, 2109,
     3, 2, 1, 1, 'GARAGE', 2,
     false, false, 'CITY', 'Biltmore Square HOA', 625.00, 7215.00,
     33.50900, -112.03450, 'MLS', 'ARMLS-6400109'),

    -- 10. Phoenix — Laveen new construction
    ('d0000001-0000-0000-0000-000000000010'::uuid, 'ACTIVE',
     '5529 W Buist Ave', 'Laveen', 'AZ', '85339', 'US',
     'Maricopa', 'Laveen Meadows', 'SINGLE_FAMILY', 2025, 5200, 1953,
     3, 2, 1, 2, 'GARAGE', 2,
     false, false, NULL, 'Laveen Meadows HOA', 65.00, 2380.00,
     33.36440, -112.16570, 'MLS', 'ARMLS-6400110'),

    -- 11. Mesa — Downtown bungalow
    ('d0000001-0000-0000-0000-000000000011'::uuid, 'ACTIVE',
     '1448 S Doran St', 'Mesa', 'AZ', '85210', 'US',
     'Maricopa', 'Downtown Mesa', 'SINGLE_FAMILY', 1960, 6098, 1118,
     3, 2, 0, 1, 'CARPORT', 1,
     false, false, NULL, NULL, NULL, 1568.00,
     33.39300, -111.82800, 'MLS', 'ARMLS-6400111'),

    -- 12. Mesa — Eastmark community
    ('d0000001-0000-0000-0000-000000000012'::uuid, 'ACTIVE',
     '10505 E Wavelength Ave', 'Mesa', 'AZ', '85212', 'US',
     'Maricopa', 'Eastmark', 'SINGLE_FAMILY', 2021, 5500, 2032,
     3, 2, 1, 2, 'GARAGE', 2,
     false, false, NULL, 'Eastmark HOA', 142.00, 3290.00,
     33.34550, -111.69100, 'MLS', 'ARMLS-6400112'),

    -- 13. Gilbert — Power Ranch estate
    ('d0000001-0000-0000-0000-000000000013'::uuid, 'ACTIVE',
     '3036 E San Pedro Ct', 'Gilbert', 'AZ', '85298', 'US',
     'Maricopa', 'Power Ranch', 'SINGLE_FAMILY', 2005, 12632, 3643,
     4, 3, 0, 2, 'GARAGE', 3,
     true, false, NULL, 'Power Ranch HOA', 165.00, 5842.00,
     33.29300, -111.72000, 'MLS', 'ARMLS-6400113'),

    -- 14. Gilbert — Val Vista Lakes townhome
    ('d0000001-0000-0000-0000-000000000014'::uuid, 'ACTIVE',
     '802 W Iris Dr', 'Gilbert', 'AZ', '85233', 'US',
     'Maricopa', 'Val Vista Lakes', 'TOWNHOUSE', 2009, 3200, 1831,
     3, 3, 0, 2, 'GARAGE', 2,
     false, true, 'LAKE', 'Val Vista Lakes HOA', 235.00, 3180.00,
     33.34800, -111.78700, 'MLS', 'ARMLS-6400114'),

    -- 15. Gilbert — Seville luxury
    ('d0000001-0000-0000-0000-000000000015'::uuid, 'ACTIVE',
     '6749 S Seneca Ct', 'Gilbert', 'AZ', '85298', 'US',
     'Maricopa', 'Seville', 'SINGLE_FAMILY', 2013, 11800, 3629,
     5, 4, 0, 2, 'GARAGE', 3,
     true, false, 'MOUNTAIN', 'Seville HOA', 190.00, 6250.00,
     33.28300, -111.73100, 'MLS', 'ARMLS-6400115'),

    -- 16. Chandler — Ocotillo Lakes family home
    ('d0000001-0000-0000-0000-000000000016'::uuid, 'ACTIVE',
     '4080 W Laredo St', 'Chandler', 'AZ', '85226', 'US',
     'Maricopa', 'Ocotillo Lakes', 'SINGLE_FAMILY', 2002, 9148, 2850,
     4, 3, 0, 1, 'GARAGE', 3,
     true, true, 'LAKE', 'Ocotillo HOA', 195.00, 4725.00,
     33.28400, -111.87200, 'MLS', 'ARMLS-6400116'),

    -- 17. Chandler — Downtown Chandler condo
    ('d0000001-0000-0000-0000-000000000017'::uuid, 'ACTIVE',
     '175 W Chandler Blvd', 'Chandler', 'AZ', '85225', 'US',
     'Maricopa', 'Downtown Chandler', 'CONDO', 2016, NULL, 1246,
     2, 2, 0, 1, 'COVERED', 1,
     false, false, 'CITY', 'San Marcos Place HOA', 310.00, 2418.00,
     33.30300, -111.84400, 'MLS', 'ARMLS-6400117'),

    -- 18. Tempe — Near ASU townhome
    ('d0000001-0000-0000-0000-000000000018'::uuid, 'ACTIVE',
     '280 S Evergreen Rd', 'Tempe', 'AZ', '85281', 'US',
     'Maricopa', 'Hayden Square', 'TOWNHOUSE', 2008, 2400, 1100,
     2, 2, 1, 2, 'COVERED', 1,
     false, false, NULL, 'Hayden Square HOA', 285.00, 2156.00,
     33.41600, -111.90800, 'MLS', 'ARMLS-6400118'),

    -- 19. Tempe — Tempe Town Lake condo
    ('d0000001-0000-0000-0000-000000000019'::uuid, 'ACTIVE',
     '140 E Rio Salado Pkwy', 'Tempe', 'AZ', '85281', 'US',
     'Maricopa', 'Northshore at Tempe Town Lake', 'CONDO', 2007, NULL, 1780,
     2, 2, 0, 1, 'GARAGE', 2,
     false, true, 'LAKE', 'Northshore HOA', 520.00, 5218.00,
     33.43100, -111.93900, 'MLS', 'ARMLS-6400119'),

    -- 20. Paradise Valley — Luxury hilltop estate
    ('d0000001-0000-0000-0000-000000000020'::uuid, 'ACTIVE',
     '5600 N Saguaro Rd', 'Paradise Valley', 'AZ', '85253', 'US',
     'Maricopa', 'Paradise Valley Ranchos', 'SINGLE_FAMILY', 2008, 43560, 6250,
     5, 5, 1, 2, 'GARAGE', 4,
     true, false, 'MOUNTAIN', NULL, NULL, 22350.00,
     33.53700, -111.94900, 'MLS', 'ARMLS-6400120'),

    -- 21. Cave Creek — Desert ranch
    ('d0000001-0000-0000-0000-000000000021'::uuid, 'ACTIVE',
     '37812 N Cave Creek Rd', 'Cave Creek', 'AZ', '85331', 'US',
     'Maricopa', 'Rancho Mañana', 'SINGLE_FAMILY', 1998, 87120, 3412,
     4, 3, 1, 1, 'GARAGE', 3,
     false, false, 'MOUNTAIN', NULL, NULL, 7845.00,
     33.82800, -111.95300, 'MLS', 'ARMLS-6400121'),

    -- 22. Fountain Hills — Golf community
    ('d0000001-0000-0000-0000-000000000022'::uuid, 'ACTIVE',
     '16810 E Parlin Dr', 'Fountain Hills', 'AZ', '85268', 'US',
     'Maricopa', 'Firerock Country Club', 'SINGLE_FAMILY', 2004, 18200, 3150,
     3, 3, 1, 1, 'GARAGE', 3,
     true, false, 'MOUNTAIN', 'FireRock HOA', 410.00, 8315.00,
     33.59500, -111.72800, 'MLS', 'ARMLS-6400122'),

    -- 23. Peoria — Vistancia family home
    ('d0000001-0000-0000-0000-000000000023'::uuid, 'ACTIVE',
     '28914 N 124th Dr', 'Peoria', 'AZ', '85383', 'US',
     'Maricopa', 'Vistancia', 'SINGLE_FAMILY', 2017, 7840, 2650,
     4, 3, 0, 2, 'GARAGE', 3,
     true, false, NULL, 'Vistancia HOA', 135.00, 4190.00,
     33.74500, -112.27400, 'MLS', 'ARMLS-6400123'),

    -- 24. Surprise — Sun City Grand 55+ community
    ('d0000001-0000-0000-0000-000000000024'::uuid, 'ACTIVE',
     '15746 W Mill Valley Ln', 'Surprise', 'AZ', '85374', 'US',
     'Maricopa', 'Sun City Grand', 'SINGLE_FAMILY', 2003, 6970, 1845,
     2, 2, 0, 1, 'GARAGE', 2,
     false, false, 'GOLF_COURSE', 'Sun City Grand HOA', 285.00, 2570.00,
     33.65600, -112.38200, 'MLS', 'ARMLS-6400124'),

    -- 25. Goodyear — Estrella Mountain Ranch
    ('d0000001-0000-0000-0000-000000000025'::uuid, 'ACTIVE',
     '16315 W Mesquite Dr', 'Goodyear', 'AZ', '85338', 'US',
     'Maricopa', 'Estrella Mountain Ranch', 'SINGLE_FAMILY', 2019, 7200, 2475,
     4, 3, 0, 2, 'GARAGE', 2,
     true, false, 'MOUNTAIN', 'Estrella Mountain HOA', 110.00, 3845.00,
     33.37800, -112.39200, 'MLS', 'ARMLS-6400125')
ON CONFLICT (property_id) DO NOTHING;

-- Trigger will set PostGIS location from lat/lng on UPDATE
UPDATE properties SET latitude = latitude, longitude = longitude WHERE property_id IN (
    'd0000001-0000-0000-0000-000000000001'::uuid,
    'd0000001-0000-0000-0000-000000000002'::uuid,
    'd0000001-0000-0000-0000-000000000003'::uuid,
    'd0000001-0000-0000-0000-000000000004'::uuid,
    'd0000001-0000-0000-0000-000000000005'::uuid,
    'd0000001-0000-0000-0000-000000000006'::uuid,
    'd0000001-0000-0000-0000-000000000007'::uuid,
    'd0000001-0000-0000-0000-000000000008'::uuid,
    'd0000001-0000-0000-0000-000000000009'::uuid,
    'd0000001-0000-0000-0000-000000000010'::uuid,
    'd0000001-0000-0000-0000-000000000011'::uuid,
    'd0000001-0000-0000-0000-000000000012'::uuid,
    'd0000001-0000-0000-0000-000000000013'::uuid,
    'd0000001-0000-0000-0000-000000000014'::uuid,
    'd0000001-0000-0000-0000-000000000015'::uuid,
    'd0000001-0000-0000-0000-000000000016'::uuid,
    'd0000001-0000-0000-0000-000000000017'::uuid,
    'd0000001-0000-0000-0000-000000000018'::uuid,
    'd0000001-0000-0000-0000-000000000019'::uuid,
    'd0000001-0000-0000-0000-000000000020'::uuid,
    'd0000001-0000-0000-0000-000000000021'::uuid,
    'd0000001-0000-0000-0000-000000000022'::uuid,
    'd0000001-0000-0000-0000-000000000023'::uuid,
    'd0000001-0000-0000-0000-000000000024'::uuid,
    'd0000001-0000-0000-0000-000000000025'::uuid
);

-- =============================================================================
-- 7. Listings — one per property, realistic prices and descriptions
-- =============================================================================
INSERT INTO listings (
    listing_id, property_id, status, list_price, original_list_price, listing_type,
    listing_date, days_on_market, description, highlights,
    listing_agent_id, listing_broker_id, is_public
) VALUES
    -- 1. Scottsdale Old Town condo
    ('e0000001-0000-0000-0000-000000000001'::uuid, 'd0000001-0000-0000-0000-000000000001'::uuid,
     'ACTIVE', 485000.00, 499000.00, 'FOR_SALE',
     '2025-11-15', 28,
     'Stylish 2-bed condo in the heart of Old Town Scottsdale. Walk to galleries, restaurants, and nightlife. Floor-to-ceiling windows, quartz countertops, and a private balcony overlooking Main Street.',
     ARRAY['Walk to Old Town', 'Quartz countertops', 'Assigned parking', 'Community pool'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 2. Scottsdale McCormick Ranch
    ('e0000001-0000-0000-0000-000000000002'::uuid, 'd0000001-0000-0000-0000-000000000002'::uuid,
     'ACTIVE', 749995.00, 749995.00, 'FOR_SALE',
     '2025-10-20', 54,
     'Charming 4-bed McCormick Ranch home with resort-style backyard. Sparkling pool, mature citrus trees, and RV gate. Updated kitchen with granite and stainless steel. Top-rated Scottsdale schools.',
     ARRAY['Pool', 'RV gate', 'Updated kitchen', 'Scottsdale Unified schools'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 3. Scottsdale Gainey Ranch estate
    ('e0000001-0000-0000-0000-000000000003'::uuid, 'd0000001-0000-0000-0000-000000000003'::uuid,
     'ACTIVE', 2500000.00, 2650000.00, 'FOR_SALE',
     '2025-09-01', 103,
     'Exquisite 4-bed Gainey Ranch estate on premium lot. Soaring ceilings, chef''s kitchen with Sub-Zero and Wolf appliances, resort pool with spa, and sweeping Camelback Mountain views. Guard-gated community with golf and tennis.',
     ARRAY['Guard-gated', 'Mountain views', 'Chef kitchen', 'Pool & spa', 'Golf community'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 4. Scottsdale Grayhawk
    ('e0000001-0000-0000-0000-000000000004'::uuid, 'd0000001-0000-0000-0000-000000000004'::uuid,
     'ACTIVE', 1125000.00, 1150000.00, 'FOR_SALE',
     '2025-10-05', 69,
     'Stunning North Scottsdale home in Grayhawk. Open floor plan with 20-foot ceilings, travertine floors, and designer finishes throughout. Heated pool, outdoor kitchen, and 3-car garage. Minutes to golf, hiking, and top dining.',
     ARRAY['Heated pool', 'Outdoor kitchen', '3-car garage', 'Grayhawk amenities'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 5. Phoenix Arcadia classic
    ('e0000001-0000-0000-0000-000000000005'::uuid, 'd0000001-0000-0000-0000-000000000005'::uuid,
     'ACTIVE', 372000.00, 385000.00, 'FOR_SALE',
     '2025-11-10', 33,
     'Classic Arcadia ranch on a generous lot. Original hardwood floors, updated electrical, and a spacious covered patio. Prime location near Arcadia''s best dining and Camelback Mountain trailheads. Bring your vision!',
     ARRAY['Hardwood floors', 'Large lot', 'Near Camelback', 'Arcadia location'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 6. Phoenix Desert Ridge
    ('e0000001-0000-0000-0000-000000000006'::uuid, 'd0000001-0000-0000-0000-000000000006'::uuid,
     'ACTIVE', 785000.00, 799000.00, 'FOR_SALE',
     '2025-10-15', 59,
     'Gorgeous Desert Ridge home with mountain views. 4 bedrooms plus loft, gourmet kitchen with island, and backyard oasis with heated pool and built-in BBQ. Walk to Desert Ridge Marketplace shops and restaurants.',
     ARRAY['Mountain views', 'Heated pool', 'Walk to shops', 'Gourmet kitchen'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 7. Phoenix Ahwatukee
    ('e0000001-0000-0000-0000-000000000007'::uuid, 'd0000001-0000-0000-0000-000000000007'::uuid,
     'ACTIVE', 739900.00, 739900.00, 'FOR_SALE',
     '2025-11-01', 42,
     'Beautifully maintained Ahwatukee Foothills home with breathtaking South Mountain views. Remodeled kitchen, spa-like master bath, sparkling pool, and lush landscaping on nearly a quarter-acre lot. Hiking trails steps away.',
     ARRAY['South Mountain views', 'Remodeled kitchen', 'Pool', 'Near hiking'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 8. Phoenix North Phoenix
    ('e0000001-0000-0000-0000-000000000008'::uuid, 'd0000001-0000-0000-0000-000000000008'::uuid,
     'ACTIVE', 430000.00, 445000.00, 'FOR_SALE',
     '2025-09-20', 114,
     'Well-maintained 3-bed North Phoenix home with an updated kitchen featuring shaker cabinets and quartz countertops. Block construction, dual-pane windows, and a covered patio. Convenient access to the 51 and I-17 freeways.',
     ARRAY['Updated kitchen', 'Block construction', 'Freeway access', 'Move-in ready'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 9. Phoenix Biltmore condo
    ('e0000001-0000-0000-0000-000000000009'::uuid, 'd0000001-0000-0000-0000-000000000009'::uuid,
     'ACTIVE', 1350000.00, 1350000.00, 'FOR_SALE',
     '2025-11-05', 38,
     'Sophisticated Biltmore-area condo with designer finishes throughout. Open concept living with chef''s kitchen, Thermador appliances, and a private terrace with city views. 24-hour concierge, rooftop pool, and fitness center.',
     ARRAY['Concierge', 'City views', 'Rooftop pool', 'Thermador appliances'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 10. Laveen new construction
    ('e0000001-0000-0000-0000-000000000010'::uuid, 'd0000001-0000-0000-0000-000000000010'::uuid,
     'ACTIVE', 479990.00, 479990.00, 'FOR_SALE',
     '2025-12-01', 12,
     'Brand-new 2025 construction in Laveen Meadows! Energy-efficient 3-bed with open floor plan, 10-foot ceilings, and a gourmet kitchen with waterfall island. Smart home features, tankless water heater, and 2-car garage.',
     ARRAY['New construction', 'Smart home', 'Energy efficient', 'No HOA hassle'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 11. Mesa Downtown bungalow
    ('e0000001-0000-0000-0000-000000000011'::uuid, 'd0000001-0000-0000-0000-000000000011'::uuid,
     'ACTIVE', 335000.00, 349900.00, 'FOR_SALE',
     '2025-08-15', 130,
     'Adorable Mesa bungalow with vintage charm and modern updates. Original hardwood floors, new roof (2023), and updated plumbing. Large backyard with citrus trees and room for a pool. Walk to downtown Mesa arts district.',
     ARRAY['Vintage charm', 'New roof', 'Large backyard', 'Walk to arts district'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 12. Mesa Eastmark
    ('e0000001-0000-0000-0000-000000000012'::uuid, 'd0000001-0000-0000-0000-000000000012'::uuid,
     'ACTIVE', 519000.00, 525000.00, 'FOR_SALE',
     '2025-10-25', 49,
     'Nearly new Eastmark home in award-winning master-planned community. Open concept with 9-foot ceilings, upgraded cabinetry, and a spa-like owner''s suite. Community boasts pools, parks, splash pads, and The Great Park.',
     ARRAY['Master-planned community', 'Spa-like master', 'Parks & pools', 'Great schools'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 13. Gilbert Power Ranch
    ('e0000001-0000-0000-0000-000000000013'::uuid, 'd0000001-0000-0000-0000-000000000013'::uuid,
     'ACTIVE', 879000.00, 899000.00, 'FOR_SALE',
     '2025-09-10', 95,
     'Expansive Power Ranch estate on a premium cul-de-sac lot. 4 bedrooms plus office, gourmet kitchen with double ovens, and a massive backyard with pool, spa, and putting green. Walking distance to Power Ranch Lake and trails.',
     ARRAY['Cul-de-sac', 'Pool & spa', 'Putting green', 'Near lake & trails'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 14. Gilbert Val Vista Lakes townhome
    ('e0000001-0000-0000-0000-000000000014'::uuid, 'd0000001-0000-0000-0000-000000000014'::uuid,
     'ACTIVE', 450000.00, 460000.00, 'FOR_SALE',
     '2025-11-20', 23,
     'Waterfront townhome in sought-after Val Vista Lakes. Stunning lake views from the patio and master bedroom. Upgraded flooring, modern kitchen, and attached 2-car garage. Community features lakes, pools, tennis, and beach.',
     ARRAY['Lake views', 'Waterfront', 'Community beach', 'Tennis & pools'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 15. Gilbert Seville luxury
    ('e0000001-0000-0000-0000-000000000015'::uuid, 'd0000001-0000-0000-0000-000000000015'::uuid,
     'ACTIVE', 950000.00, 975000.00, 'FOR_SALE',
     '2025-10-01', 73,
     'Stunning 5-bed Seville estate with mountain views. Grand entrance, gourmet kitchen with center island, and resort-style backyard with heated pool, waterfall, and fire pit. Three-car tandem garage and RV gate.',
     ARRAY['Mountain views', 'Resort backyard', 'RV gate', '5 bedrooms'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 16. Chandler Ocotillo Lakes
    ('e0000001-0000-0000-0000-000000000016'::uuid, 'd0000001-0000-0000-0000-000000000016'::uuid,
     'ACTIVE', 725000.00, 745000.00, 'FOR_SALE',
     '2025-09-25', 79,
     'Lakefront Ocotillo home with spectacular sunset views across the water. 4-bed with open floor plan, travertine floors, and a chef''s kitchen. Heated pool, waterfall, and private dock access. Walk to Ocotillo Golf Resort.',
     ARRAY['Lakefront', 'Sunset views', 'Private dock', 'Walk to golf'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 17. Chandler Downtown condo
    ('e0000001-0000-0000-0000-000000000017'::uuid, 'd0000001-0000-0000-0000-000000000017'::uuid,
     'ACTIVE', 365000.00, 375000.00, 'FOR_SALE',
     '2025-11-08', 35,
     'Modern downtown Chandler condo steps from restaurants, craft breweries, and the Chandler Center for the Arts. Open layout with 10-foot ceilings, stainless appliances, and in-unit laundry. One covered parking space.',
     ARRAY['Walk to dining', 'In-unit laundry', '10-foot ceilings', 'Near light rail'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 18. Tempe near ASU
    ('e0000001-0000-0000-0000-000000000018'::uuid, 'd0000001-0000-0000-0000-000000000018'::uuid,
     'ACTIVE', 370000.00, 379900.00, 'FOR_SALE',
     '2025-10-30', 44,
     'Stylish Tempe townhome blocks from ASU and Mill Avenue. 2-bed plus loft, granite countertops, and a private rooftop deck with mountain views. Walk to light rail, Tempe Marketplace, and Tempe Town Lake.',
     ARRAY['Near ASU', 'Rooftop deck', 'Walk to light rail', 'Mill Ave dining'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 19. Tempe Town Lake condo
    ('e0000001-0000-0000-0000-000000000019'::uuid, 'd0000001-0000-0000-0000-000000000019'::uuid,
     'ACTIVE', 625000.00, 649000.00, 'FOR_SALE',
     '2025-10-12', 62,
     'Luxury lakefront condo at Northshore on Tempe Town Lake. Floor-to-ceiling windows, hardwood floors, and a gourmet kitchen with Viking appliances. Panoramic lake and mountain views from your private balcony. Resort amenities include infinity pool and fitness center.',
     ARRAY['Lakefront', 'Panoramic views', 'Infinity pool', 'Viking appliances'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 20. Paradise Valley estate
    ('e0000001-0000-0000-0000-000000000020'::uuid, 'd0000001-0000-0000-0000-000000000020'::uuid,
     'ACTIVE', 6500000.00, 6950000.00, 'FOR_SALE',
     '2025-07-15', 160,
     'Iconic Paradise Valley estate on a full acre with unobstructed Camelback Mountain views. 5 bedrooms, 5.5 baths, custom stone and timber construction, wine cellar, home theater, and a negative-edge pool. Lush desert landscaping with mature saguaros.',
     ARRAY['Camelback views', 'Wine cellar', 'Home theater', 'Negative-edge pool', '1-acre lot'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 21. Cave Creek ranch
    ('e0000001-0000-0000-0000-000000000021'::uuid, 'd0000001-0000-0000-0000-000000000021'::uuid,
     'ACTIVE', 1295000.00, 1350000.00, 'FOR_SALE',
     '2025-08-20', 125,
     'Stunning Cave Creek retreat on 2 acres of pristine Sonoran desert. 4 bedrooms, open beam ceilings, and a gourmet kitchen. Horse property with barn, tack room, and arena. Panoramic mountain and sunset views from the wraparound patio.',
     ARRAY['2-acre lot', 'Horse property', 'Panoramic views', 'Barn & arena'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 22. Fountain Hills golf
    ('e0000001-0000-0000-0000-000000000022'::uuid, 'd0000001-0000-0000-0000-000000000022'::uuid,
     'ACTIVE', 1175000.00, 1200000.00, 'FOR_SALE',
     '2025-09-15', 89,
     'Elegant Fountain Hills home in the prestigious FireRock Country Club. 3 bedrooms plus casita, gourmet kitchen, and a resort backyard with heated pool, spa, and fire pit. Unobstructed Four Peaks and Red Mountain views.',
     ARRAY['Country club', 'Four Peaks views', 'Casita', 'Heated pool & spa'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 23. Peoria Vistancia
    ('e0000001-0000-0000-0000-000000000023'::uuid, 'd0000001-0000-0000-0000-000000000023'::uuid,
     'ACTIVE', 595000.00, 610000.00, 'FOR_SALE',
     '2025-10-08', 66,
     'Beautiful 4-bed Vistancia home with mountain views. Modern kitchen with white cabinetry and quartz countertops, spacious loft, and a backyard oasis with heated pool and synthetic grass. Walk to Blackstone community center.',
     ARRAY['Mountain views', 'Heated pool', 'Synthetic grass', 'Community center'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 24. Surprise Sun City Grand
    ('e0000001-0000-0000-0000-000000000024'::uuid, 'd0000001-0000-0000-0000-000000000024'::uuid,
     'ACTIVE', 415000.00, 429000.00, 'FOR_SALE',
     '2025-11-12', 31,
     'Charming Sun City Grand 55+ home with golf course views. 2 bedrooms plus den, updated kitchen with soft-close cabinets, and a covered patio with ceiling fans. Community offers 4 golf courses, fitness centers, pools, and 100+ clubs.',
     ARRAY['55+ community', 'Golf course views', '4 golf courses', '100+ clubs'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- 25. Goodyear Estrella Mountain Ranch
    ('e0000001-0000-0000-0000-000000000025'::uuid, 'd0000001-0000-0000-0000-000000000025'::uuid,
     'ACTIVE', 549000.00, 549000.00, 'FOR_SALE',
     '2025-11-25', 18,
     'Like-new Estrella Mountain Ranch home with stunning Estrella Mountain views. 4 bedrooms, modern farmhouse kitchen with shaker cabinets and quartz waterfall island, and a sparkling pool with ramada. Near Starpointe Residents Club.',
     ARRAY['Mountain views', 'Sparkling pool', 'Modern farmhouse', 'Community amenities'],
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, true),

    -- DRAFT listing (broker = Acme): BUYER/BUYER_AGENT must NOT see via RLS (06; list + get 404).
    ('e0000001-0000-0000-0000-000000000026'::uuid, 'd0000001-0000-0000-0000-000000000001'::uuid,
     'DRAFT', 510000.00, 510000.00, 'FOR_SALE',
     NULL, 0,
     'Draft listing not yet public — for RLS negative test.',
     NULL,
     'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (listing_id) DO NOTHING;

-- =============================================================================
-- 7.1 LISTED transaction linked to a public listing (journey wiring)
-- =============================================================================
INSERT INTO transactions (transaction_id, organization_id, current_state, property_id, listing_id) VALUES
    ('c0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'LISTED',
     'd0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000003'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000003'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- =============================================================================
-- 7.2 Transactions in every state (for full UI test suite: switch users in admin menu)
--    All Acme org; parties vary so each role has transactions to view.
--    ON CONFLICT DO UPDATE so re-running seed resets states (e.g. 007 stays CLEAR_TO_CLOSE for champagne test).
-- =============================================================================
INSERT INTO transactions (transaction_id, organization_id, current_state, property_id, listing_id, offer_price) VALUES
    ('c0000001-0000-0000-0000-000000000004'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'OFFER_MADE',
     'd0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid, 475000.00),
    ('c0000001-0000-0000-0000-000000000005'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'DUE_DILIGENCE',
     'd0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid, 480000.00),
    ('c0000001-0000-0000-0000-000000000006'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'FINANCING',
     'd0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid, 478000.00),
    ('c0000001-0000-0000-0000-000000000007'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'CLEAR_TO_CLOSE',
     'd0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid, 478000.00),
    ('c0000001-0000-0000-0000-000000000008'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'CLOSED',
     'd0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid, 478000.00),
    ('c0000001-0000-0000-0000-000000000009'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'CANCELLED',
     NULL, NULL, NULL)
ON CONFLICT (transaction_id) DO UPDATE SET
  current_state = EXCLUDED.current_state,
  property_id = EXCLUDED.property_id,
  listing_id = EXCLUDED.listing_id,
  offer_price = EXCLUDED.offer_price,
  updated_at = now();

-- OFFER_MADE (004): Alice, Carol, Bob, Bailey (buyer agent)
INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000004'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000004'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER'),
    ('c0000001-0000-0000-0000-000000000004'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER'),
    ('c0000001-0000-0000-0000-000000000004'::uuid, 'b0000001-0000-0000-0000-000000000006'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER_AGENT')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- One offer on tx 004 (OFFER_MADE) for negative test: accept without signed PA (offer_id must be valid UUID: hex 0-9a-f only)
INSERT INTO offers (offer_id, transaction_id, status, terms, created_by_user_id) VALUES
    ('00000001-0000-0000-0000-000000000004'::uuid, 'c0000001-0000-0000-0000-000000000004'::uuid, 'SUBMITTED',
     '{"price": 475000}'::jsonb, 'b0000001-0000-0000-0000-000000000002'::uuid)
ON CONFLICT (offer_id) DO NOTHING;

-- DUE_DILIGENCE (005): Alice, Carol, Bob, Bailey (BUYER_AGENT), Dave, Ivy (inspector) — for milestone gating test
INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000005'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000005'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER'),
    ('c0000001-0000-0000-0000-000000000005'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER'),
    ('c0000001-0000-0000-0000-000000000005'::uuid, 'b0000001-0000-0000-0000-000000000006'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER_AGENT'),
    ('c0000001-0000-0000-0000-000000000005'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'ESCROW_OFFICER'),
    ('c0000001-0000-0000-0000-000000000005'::uuid, 'b0000001-0000-0000-0000-000000000013'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'INSPECTOR')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- Reset tx 005 to clean DUE_DILIGENCE for milestone gating test (test_due_diligence_to_financing_requires_title_and_appraisal).
-- Seed is re-run before tests; without this, a previous test run could leave title/waiver on 005 and the test would get 200 instead of 412.
UPDATE transactions SET current_state = 'DUE_DILIGENCE' WHERE transaction_id = 'c0000001-0000-0000-0000-000000000005'::uuid;
DELETE FROM appraisal_waivers WHERE transaction_id = 'c0000001-0000-0000-0000-000000000005'::uuid;
DELETE FROM title_orders WHERE transaction_id = 'c0000001-0000-0000-0000-000000000005'::uuid;

-- FINANCING (006): Alice, Carol, Bob, Dave, Eve
INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000006'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000006'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER'),
    ('c0000001-0000-0000-0000-000000000006'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER'),
    ('c0000001-0000-0000-0000-000000000006'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'ESCROW_OFFICER'),
    ('c0000001-0000-0000-0000-000000000006'::uuid, 'b0000001-0000-0000-0000-000000000005'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'LENDER')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- CLEAR_TO_CLOSE (007): Alice, Carol, Bob, Dave, Eve
INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000007'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000007'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER'),
    ('c0000001-0000-0000-0000-000000000007'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER'),
    ('c0000001-0000-0000-0000-000000000007'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'ESCROW_OFFICER'),
    ('c0000001-0000-0000-0000-000000000007'::uuid, 'b0000001-0000-0000-0000-000000000005'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'LENDER')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- CLOSED (008): Alice, Carol, Bob, Dave, Eve
INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000008'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000008'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER'),
    ('c0000001-0000-0000-0000-000000000008'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'BUYER'),
    ('c0000001-0000-0000-0000-000000000008'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'ESCROW_OFFICER'),
    ('c0000001-0000-0000-0000-000000000008'::uuid, 'b0000001-0000-0000-0000-000000000005'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'LENDER')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- CANCELLED (009): Alice, Carol (seller-side; was listed then cancelled)
INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000009'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER_AGENT'),
    ('c0000001-0000-0000-0000-000000000009'::uuid, 'b0000001-0000-0000-0000-000000000003'::uuid, 'a0000001-0000-0000-0000-000000000001'::uuid, 'SELLER')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- =============================================================================
-- 7.2b Milestone data for tx 007 (CLEAR_TO_CLOSE) so escrow can close and trigger champagne notification
--     Required: signed funding_confirmation document; funding_confirmations.verified; disbursement; deed; ownership.
-- =============================================================================
INSERT INTO documents (document_id, transaction_id, document_type, execution_status) VALUES
    ('a1000001-0000-0000-0000-000000000007'::uuid, 'c0000001-0000-0000-0000-000000000007'::uuid, 'funding_confirmation', 'signed')
ON CONFLICT (document_id) DO NOTHING;

INSERT INTO funding_confirmations (confirmation_id, transaction_id, confirmed_by_user_id, verified, notes) VALUES
    ('b1000001-0000-0000-0000-000000000007'::uuid, 'c0000001-0000-0000-0000-000000000007'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, true, 'Seed: funds confirmed for champagne test')
ON CONFLICT (confirmation_id) DO NOTHING;

INSERT INTO disbursements (disbursement_id, transaction_id, amount, recipient, recorded_by_user_id, notes) VALUES
    ('b2000001-0000-0000-0000-000000000007'::uuid, 'c0000001-0000-0000-0000-000000000007'::uuid, 478000.00, 'Seller proceeds', 'b0000001-0000-0000-0000-000000000004'::uuid, 'Seed: disbursement recorded')
ON CONFLICT (disbursement_id) DO NOTHING;

INSERT INTO deed_recordings (recording_id, transaction_id, recording_reference) VALUES
    ('b3000001-0000-0000-0000-000000000007'::uuid, 'c0000001-0000-0000-0000-000000000007'::uuid, 'Seed-2025-007')
ON CONFLICT (recording_id) DO NOTHING;

INSERT INTO ownership_transfers (transfer_id, transaction_id, notes) VALUES
    ('b4000001-0000-0000-0000-000000000007'::uuid, 'c0000001-0000-0000-0000-000000000007'::uuid, 'Seed: ownership transfer confirmed')
ON CONFLICT (transfer_id) DO NOTHING;

-- =============================================================================
-- 7.3 One transaction per non-Acme org (so Dave / Eve see something with their own org)
-- =============================================================================
INSERT INTO transactions (transaction_id, organization_id, current_state, offer_price) VALUES
    ('c0000001-0000-0000-0000-000000000010'::uuid, 'a0000001-0000-0000-0000-000000000002'::uuid, 'UNDER_CONTRACT', 475000.00),
    ('c0000001-0000-0000-0000-000000000011'::uuid, 'a0000001-0000-0000-0000-000000000003'::uuid, 'FINANCING', 620000.00)
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO transaction_parties (transaction_id, user_id, organization_id, role) VALUES
    ('c0000001-0000-0000-0000-000000000010'::uuid, 'b0000001-0000-0000-0000-000000000004'::uuid, 'a0000001-0000-0000-0000-000000000002'::uuid, 'ESCROW_OFFICER'),
    ('c0000001-0000-0000-0000-000000000011'::uuid, 'b0000001-0000-0000-0000-000000000005'::uuid, 'a0000001-0000-0000-0000-000000000003'::uuid, 'LENDER')
ON CONFLICT (transaction_id, user_id, role) DO NOTHING;

-- =============================================================================
-- 8. Mock buyer preference (updated for AZ market)
-- =============================================================================
INSERT INTO buyer_preferences (preference_id, user_id, price_min, price_max, bedrooms_min, preferred_states) VALUES
    ('f0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid,
     400000, 800000, 3, ARRAY['AZ'])
ON CONFLICT (preference_id) DO NOTHING;

-- =============================================================================
-- 9. Property images (for GET /properties/{id}/images and search image_count)
-- =============================================================================
-- image_id must be hex-only (0-9a-f) for FastAPI path params
INSERT INTO property_images (
    image_id, property_id, listing_id, uploaded_by, storage_path, storage_bucket,
    file_size_bytes, mime_type, checksum, is_primary, display_order, moderation_status
) VALUES
    ('91000001-0000-0000-0000-000000000001'::uuid, 'd0000001-0000-0000-0000-000000000001'::uuid,
     'e0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid,
     'properties/d0000001-0000-0000-0000-000000000001/img1.jpg', 'realtrust-seed', 1024,
     'image/jpeg', 'seed-checksum-1', true, 0, 'APPROVED')
ON CONFLICT (image_id) DO NOTHING;

-- =============================================================================
-- 10. Property matches (for GET /users/me/recommendations and GET /listings/{id}/interested-buyers)
--     match_id must be valid UUID (hex 0-9a-f only); use 0e000001 prefix for "match"
-- =============================================================================
INSERT INTO property_matches (match_id, user_id, preference_id, listing_id, match_score, score_breakdown, ai_explanation) VALUES
    ('0e000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid,
     'f0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid,
     0.9200, '{"price": 0.95, "features": 0.88, "semantic": 0.91, "location": 0.94}'::jsonb,
     'This 2-bed Scottsdale condo is within your budget and close to Old Town dining.'),
    ('0e000001-0000-0000-0000-000000000002'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid,
     'f0000001-0000-0000-0000-000000000001'::uuid, 'e0000001-0000-0000-0000-000000000002'::uuid,
     0.8500, '{"price": 0.90, "features": 0.82, "semantic": 0.85, "location": 0.88}'::jsonb,
     'McCormick Ranch 4-bed with pool is a great fit for your AZ preference.')
ON CONFLICT (preference_id, listing_id) DO NOTHING;

-- 9b. Saved listings (Bob saved one listing)
INSERT INTO saved_listings (user_id, listing_id) VALUES
    ('b0000001-0000-0000-0000-000000000002'::uuid, 'e0000001-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (user_id, listing_id) DO NOTHING;

-- =============================================================================
-- 11. Messaging: transaction chat room + members + one message (for chat API tests)
--    Use hex-only UUIDs (0-9a-f) so FastAPI path params accept them.
-- =============================================================================
INSERT INTO messaging.chat_rooms (room_id, room_type, transaction_id, created_by, is_archived) VALUES
    ('a1000001-0000-0000-0000-000000000001'::uuid, 'TRANSACTION', 'c0000001-0000-0000-0000-000000000001'::uuid,
     'b0000001-0000-0000-0000-000000000001'::uuid, false)
ON CONFLICT (room_id) DO NOTHING;

INSERT INTO messaging.chat_room_members (room_id, user_id, role) VALUES
    ('a1000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000001'::uuid, 'OWNER'),
    ('a1000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0000-0000-0000-000000000002'::uuid, 'MEMBER')
ON CONFLICT (room_id, user_id) DO NOTHING;

INSERT INTO messaging.messages (message_id, room_id, sender_id, message_type, content) VALUES
    ('a2000001-0000-0000-0000-000000000001'::uuid, 'a1000001-0000-0000-0000-000000000001'::uuid,
     'b0000001-0000-0000-0000-000000000001'::uuid, 'TEXT', 'Welcome to the transaction chat.')
ON CONFLICT (message_id) DO UPDATE
SET room_id = EXCLUDED.room_id,
    sender_id = EXCLUDED.sender_id,
    message_type = EXCLUDED.message_type,
    content = EXCLUDED.content,
    is_deleted = false,
    edited_at = NULL;

COMMIT;
