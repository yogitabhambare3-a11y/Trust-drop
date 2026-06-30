#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Bytes, BytesN, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 13,
    NotAuthorized = 2,
    DropAlreadyExists = 3,
    DropNotFound = 4,
    InvalidProof = 5,
    AlreadyClaimed = 6,
    ClaimNotStarted = 7,
    ClaimExpired = 8,
    InsufficientContractBalance = 9,
    InvalidAmount = 10,
    ClaimWindowActive = 11,
    NothingToWithdraw = 12,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Drop(u64),
    Claimed(u64, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Drop {
    pub merkle_root: BytesN<32>,
    pub token: Address,
    pub total_amount: i128,
    pub distributed_amount: i128,
    pub claim_start: u64,
    pub claim_end: u64,
    pub admin: Address,
    pub claim_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DropView {
    pub merkle_root: BytesN<32>,
    pub token: Address,
    pub total_amount: i128,
    pub distributed_amount: i128,
    pub claim_start: u64,
    pub claim_end: u64,
    pub admin: Address,
    pub claim_count: u32,
}

#[contract]
pub struct EligibilityRegistry;

fn require_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn load_drop(env: &Env, drop_id: u64) -> Result<Drop, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Drop(drop_id))
        .ok_or(Error::DropNotFound)
}

fn store_drop(env: &Env, drop_id: u64, drop: &Drop) {
    env.storage().persistent().set(&DataKey::Drop(drop_id), drop);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Drop(drop_id), 100, 100_000);
}

/// Leaf = keccak256(wallet_str_bytes || amount_i128_be_bytes)
/// Matches backend Merkle builder for cross-stack proof verification.
pub fn compute_leaf_hash(env: &Env, claimer: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&claimer.to_string().to_bytes());
    data.append(&Bytes::from_array(env, &amount.to_be_bytes()));
    env.crypto().keccak256(&data).into()
}

pub fn verify_merkle_proof(
    env: &Env,
    proof: &Vec<BytesN<32>>,
    root: &BytesN<32>,
    leaf: &BytesN<32>,
) -> bool {
    let mut computed = leaf.clone();
    for sibling in proof.iter() {
        let mut pair = Bytes::new(env);
        if computed < sibling {
            pair.append(&computed.to_bytes());
            pair.append(&sibling.to_bytes());
        } else {
            pair.append(&sibling.to_bytes());
            pair.append(&computed.to_bytes());
        }
        computed = env.crypto().keccak256(&pair).into();
    }
    computed == *root
}

#[contractimpl]
impl EligibilityRegistry {
    /// One-time setup: stores the platform admin who can create drops.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Stores drop configuration. Admin must fund the contract with `total_amount` of `token` separately.
    pub fn create_drop(
        env: Env,
        drop_id: u64,
        merkle_root: BytesN<32>,
        token_addr: Address,
        total_amount: i128,
        claim_start: u64,
        claim_end: u64,
        admin: Address,
    ) -> Result<(), Error> {
        let stored_admin = require_admin(&env)?;
        admin.require_auth();
        if admin != stored_admin {
            return Err(Error::NotAuthorized);
        }
        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if claim_end <= claim_start {
            return Err(Error::InvalidAmount);
        }
        if env.storage().persistent().has(&DataKey::Drop(drop_id)) {
            return Err(Error::DropAlreadyExists);
        }

        let drop = Drop {
            merkle_root,
            token: token_addr,
            total_amount,
            distributed_amount: 0,
            claim_start,
            claim_end,
            admin,
            claim_count: 0,
        };
        store_drop(&env, drop_id, &drop);
        Ok(())
    }

    /// Verifies Merkle proof, enforces time window and one-claim-per-wallet, transfers tokens.
    pub fn claim(
        env: Env,
        drop_id: u64,
        claimer: Address,
        amount: i128,
        merkle_proof: Vec<BytesN<32>>,
    ) -> Result<(), Error> {
        claimer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut drop = load_drop(&env, drop_id)?;
        let now = env.ledger().timestamp();

        if now < drop.claim_start {
            return Err(Error::ClaimNotStarted);
        }
        if now > drop.claim_end {
            return Err(Error::ClaimExpired);
        }

        let claimed_key = DataKey::Claimed(drop_id, claimer.clone());
        if env.storage().persistent().has(&claimed_key) {
            return Err(Error::AlreadyClaimed);
        }

        let leaf = compute_leaf_hash(&env, &claimer, amount);
        if !verify_merkle_proof(&env, &merkle_proof, &drop.merkle_root, &leaf) {
            return Err(Error::InvalidProof);
        }

        if drop.distributed_amount + amount > drop.total_amount {
            return Err(Error::InsufficientContractBalance);
        }

        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &drop.token);
        let balance = token_client.balance(&contract_addr);
        if balance < amount {
            return Err(Error::InsufficientContractBalance);
        }

        token_client.transfer(&contract_addr, &claimer, &amount);

        drop.distributed_amount += amount;
        drop.claim_count += 1;
        store_drop(&env, drop_id, &drop);

        env.storage().persistent().set(&claimed_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&claimed_key, 100, 100_000);

        Ok(())
    }

    pub fn get_drop(env: Env, drop_id: u64) -> Result<DropView, Error> {
        let drop = load_drop(&env, drop_id)?;
        Ok(DropView {
            merkle_root: drop.merkle_root,
            token: drop.token,
            total_amount: drop.total_amount,
            distributed_amount: drop.distributed_amount,
            claim_start: drop.claim_start,
            claim_end: drop.claim_end,
            admin: drop.admin,
            claim_count: drop.claim_count,
        })
    }

    pub fn has_claimed(env: Env, drop_id: u64, wallet: Address) -> Result<bool, Error> {
        let _drop = load_drop(&env, drop_id)?;
        Ok(env
            .storage()
            .persistent()
            .has(&DataKey::Claimed(drop_id, wallet)))
    }

    pub fn claim_count(env: Env, drop_id: u64) -> Result<u32, Error> {
        let drop = load_drop(&env, drop_id)?;
        Ok(drop.claim_count)
    }

    /// Admin withdraws unclaimed tokens after the claim window closes.
    pub fn withdraw_unclaimed(env: Env, drop_id: u64) -> Result<i128, Error> {
        let drop = load_drop(&env, drop_id)?;
        drop.admin.require_auth();

        let now = env.ledger().timestamp();
        if now <= drop.claim_end {
            return Err(Error::ClaimWindowActive);
        }

        let remaining = drop.total_amount - drop.distributed_amount;
        if remaining <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        let contract_addr = env.current_contract_address();
        let token_client = token::Client::new(&env, &drop.token);
        token_client.transfer(&contract_addr, &drop.admin, &remaining);

        Ok(remaining)
    }
}

mod test;
