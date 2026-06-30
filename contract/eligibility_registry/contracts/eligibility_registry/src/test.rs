#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, Vec,
};

fn setup_env() -> (Env, Address, Address, Address, TokenClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let claimer = Address::generate(&env);
    let contract_id = env.register(EligibilityRegistry, ());
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    client.initialize(&admin);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_admin = StellarAssetClient::new(&env, &sac.address());
    let token = TokenClient::new(&env, &sac.address());

    token_admin.mint(&contract_id, &10_000_000);

    (env, admin, claimer, contract_id, token)
}

fn set_timestamp(env: &Env, ts: u64) {
    env.ledger().set(LedgerInfo {
        timestamp: ts,
        protocol_version: 25,
        sequence_number: 10,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 100,
        min_persistent_entry_ttl: 100,
        max_entry_ttl: 100_000,
    });
}

#[test]
fn test_create_drop_and_get_drop() {
    let (env, admin, _claimer, contract_id, token) = setup_env();
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    let root = BytesN::from_array(&env, &[1u8; 32]);
    client.create_drop(
        &1u64,
        &root,
        &token.address,
        &1000i128,
        &100u64,
        &200u64,
        &admin,
    );

    let drop = client.get_drop(&1u64);
    assert_eq!(drop.merkle_root, root);
    assert_eq!(drop.total_amount, 1000);
    assert_eq!(drop.claim_count, 0);
}

#[test]
fn test_unauthorized_create_drop() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);
    let contract_id = env.register(EligibilityRegistry, ());
    let client = EligibilityRegistryClient::new(&env, &contract_id);
    client.initialize(&admin);

    let token = Address::generate(&env);
    let root = BytesN::from_array(&env, &[2u8; 32]);

    let result = client.try_create_drop(
        &2u64,
        &root,
        &token,
        &500i128,
        &100u64,
        &200u64,
        &impostor,
    );
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));
}

#[test]
fn test_valid_claim_with_single_leaf_tree() {
    let (env, admin, claimer, contract_id, token) = setup_env();
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    let amount = 500i128;
    let leaf = compute_leaf_hash(&env, &claimer, amount);
    let root = leaf.clone();

    client.create_drop(
        &10u64,
        &root,
        &token.address,
        &1000i128,
        &100u64,
        &200u64,
        &admin,
    );

    set_timestamp(&env, 150);

    let proof = Vec::new(&env);
    client.claim(&10u64, &claimer, &amount, &proof);

    assert!(client.has_claimed(&10u64, &claimer));
    assert_eq!(client.claim_count(&10u64), 1);
    assert_eq!(token.balance(&claimer), amount);
}

#[test]
fn test_invalid_proof_rejected() {
    let (env, admin, claimer, contract_id, token) = setup_env();
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    let root = BytesN::from_array(&env, &[9u8; 32]);
    client.create_drop(
        &11u64,
        &root,
        &token.address,
        &1000i128,
        &100u64,
        &200u64,
        &admin,
    );

    set_timestamp(&env, 150);

    let proof = Vec::new(&env);
    let result = client.try_claim(&11u64, &claimer, &100i128, &proof);
    assert_eq!(result, Err(Ok(Error::InvalidProof)));
}

#[test]
fn test_double_claim_rejected() {
    let (env, admin, claimer, contract_id, token) = setup_env();
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    let amount = 100i128;
    let leaf = compute_leaf_hash(&env, &claimer, amount);
    let root = leaf.clone();

    client.create_drop(
        &12u64,
        &root,
        &token.address,
        &1000i128,
        &100u64,
        &200u64,
        &admin,
    );

    set_timestamp(&env, 150);
    let proof = Vec::new(&env);
    client.claim(&12u64, &claimer, &amount, &proof);

    let result = client.try_claim(&12u64, &claimer, &amount, &proof);
    assert_eq!(result, Err(Ok(Error::AlreadyClaimed)));
}

#[test]
fn test_claim_before_window_rejected() {
    let (env, admin, claimer, contract_id, token) = setup_env();
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    let amount = 100i128;
    let leaf = compute_leaf_hash(&env, &claimer, amount);
    let root = leaf.clone();

    client.create_drop(
        &13u64,
        &root,
        &token.address,
        &1000i128,
        &100u64,
        &200u64,
        &admin,
    );

    set_timestamp(&env, 50);
    let proof = Vec::new(&env);
    let result = client.try_claim(&13u64, &claimer, &amount, &proof);
    assert_eq!(result, Err(Ok(Error::ClaimNotStarted)));
}

#[test]
fn test_claim_after_window_rejected() {
    let (env, admin, claimer, contract_id, token) = setup_env();
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    let amount = 100i128;
    let leaf = compute_leaf_hash(&env, &claimer, amount);
    let root = leaf.clone();

    client.create_drop(
        &14u64,
        &root,
        &token.address,
        &1000i128,
        &100u64,
        &200u64,
        &admin,
    );

    set_timestamp(&env, 250);
    let proof = Vec::new(&env);
    let result = client.try_claim(&14u64, &claimer, &amount, &proof);
    assert_eq!(result, Err(Ok(Error::ClaimExpired)));
}

#[test]
fn test_withdraw_unclaimed_after_window() {
    let (env, admin, claimer, contract_id, token) = setup_env();
    let client = EligibilityRegistryClient::new(&env, &contract_id);

    let amount = 300i128;
    let leaf = compute_leaf_hash(&env, &claimer, amount);
    let root = leaf.clone();

    client.create_drop(
        &15u64,
        &root,
        &token.address,
        &1000i128,
        &100u64,
        &200u64,
        &admin,
    );

    set_timestamp(&env, 150);
    client.claim(&15u64, &claimer, &amount, &Vec::new(&env));

    set_timestamp(&env, 300);
    let withdrawn = client.withdraw_unclaimed(&15u64);
    assert_eq!(withdrawn, 700);
}
