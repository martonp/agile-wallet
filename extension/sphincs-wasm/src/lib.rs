//! The SPHINCS- C13 signer (contracts/lib/SPHINCS-/signers/signer-wasm) behind a plain C ABI, so the extension can
//! load it without wasm-bindgen. Keys come from 32 bytes of seed material, derived as `signer-c13 keygen` does.

use sphincs_c13_signer::hash::{self, U256};
use sphincs_c13_signer::{merkle, sphincs, u256_from_be};

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// Writes the public key, pkSeed (32) ‖ pkRoot (32), to `out`.
#[no_mangle]
pub unsafe extern "C" fn sphincs_public_key(material: *const u8, out: *mut u8) {
    let (seed, _, root) = keys(&*(material as *const [u8; 32]));
    let out = core::slice::from_raw_parts_mut(out, 64);
    out[..32].copy_from_slice(&hash::to_bytes32(seed));
    out[32..].copy_from_slice(&hash::to_bytes32(root));
}

/// Writes the 3688-byte signature of the 32-byte `digest` to `out`. Returns 0 on success.
#[no_mangle]
pub unsafe extern "C" fn sphincs_sign(material: *const u8, digest: *const u8, out: *mut u8) -> i32 {
    let (seed, sk_seed, root) = keys(&*(material as *const [u8; 32]));
    match sphincs::sign(seed, sk_seed, root, u256_from_be(&*(digest as *const [u8; 32]))) {
        Ok(sig) => {
            core::slice::from_raw_parts_mut(out, sig.len()).copy_from_slice(&sig);
            0
        }
        Err(_) => 1,
    }
}

/// (pkSeed, skSeed, pkRoot), as signer-c13's derive_keys and keygen.
fn keys(material: &[u8; 32]) -> (U256, U256, U256) {
    let entropy = hash::to_bytes32(hash::keccak256(&[b"sphincs_signer_v1".as_slice(), material].concat()));
    let seed = hash::mask_n(hash::keccak256(&[b"pk_seed".as_slice(), &entropy].concat()));
    let sk_seed = hash::keccak256(&[b"sk_seed".as_slice(), &entropy].concat());
    (seed, sk_seed, merkle::build_subtree_root(seed, sk_seed, 1, 0))
}
