"""The Crypto-Agility Mempool's ID: the CIDv0 that `ipfs add --cid-version 0 docs/CRYPTO_AGILITY.md`
gives, for files under one 256 KiB chunk (sha2-256 multihash of a dag-pb node whose Data is a UnixFS
File holding the bytes)."""
import hashlib, sys

def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n: return bytes(out)

def field(tag, data):  # length-delimited protobuf field
    return bytes([tag]) + varint(len(data)) + data

def cidv0(content):
    assert len(content) <= 262144
    unixfs = b"\x08\x02" + (field(0x12, content) if content else b"") + b"\x18" + varint(len(content))
    node = field(0x0A, unixfs)
    mh = b"\x12\x20" + hashlib.sha256(node).digest()
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(mh, "big"); s = ""
    while n: n, r = divmod(n, 58); s = alphabet[r] + s
    return "1" * (len(mh) - len(mh.lstrip(b"\0"))) + s

if __name__ == "__main__":
    print(cidv0(open(sys.argv[1], "rb").read()))
