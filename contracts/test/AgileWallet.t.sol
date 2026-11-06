// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgileWallet} from "../src/AgileWallet.sol";
import {AgileWalletFactory} from "../src/AgileWalletFactory.sol";
import {IVerifier} from "../src/IVerifier.sol";
import {FrameTxMock, MockVerifier} from "./mocks/FrameTxMock.sol";

contract AgileWalletTest is Test {
    event Approved(uint256 scope);

    uint256 private constant VERIFY = 1;
    uint256 private constant SENDER = 2;
    uint256 private constant ARBITRARY = 0;
    uint256 private constant SECP256K1 = 1;
    uint256 private constant EXECUTION_AND_PAYMENT = 3;
    bytes32 private constant SIG_HASH = keccak256("frame tx sig hash");

    FrameTxMock private frameTx = new FrameTxMock();
    AgileWalletFactory private factory = new AgileWalletFactory();
    // deployCode, not an import: EcdsaVerifier then compiles with one solc version, so its CREATE2 address is fixed
    IVerifier private ecdsa = IVerifier(deployCode("EcdsaVerifier.sol:EcdsaVerifier"));
    MockVerifier private pq = new MockVerifier();

    uint256 private ecdsaPrivateKey = 0xA11CE;
    address private owner = vm.addr(ecdsaPrivateKey);
    bytes private ecdsaKey = abi.encodePacked(owner);
    bytes private falconKey = "falcon public key";
    bytes private sphincsKey = "sphincs public key";
    bytes private newKey = "a future scheme's public key";

    AgileWallet private wallet;

    function setUp() public {
        frameTx.install(vm, address(factory.implementation()));
        wallet = _deploy(owner, _all());
    }

    // ---- helpers ----------------------------------------------------------------------------------------------

    function _scheme(IVerifier verifier, bytes memory key) private pure returns (AgileWallet.Scheme memory) {
        return AgileWallet.Scheme(verifier, key);
    }

    /// Deploys as the deploy frame of the wallet's first transaction does, which `owner_` signed.
    function _deploy(address owner_, AgileWallet.Scheme[] memory initial) private returns (AgileWallet) {
        frameTx.reset(SIG_HASH);
        frameTx.addProtocolSignature(owner_, 0);
        return AgileWallet(payable(factory.deploy(owner_, initial)));
    }

    function _all() private view returns (AgileWallet.Scheme[] memory s) {
        s = new AgileWallet.Scheme[](3);
        s[0] = _scheme(ecdsa, ecdsaKey);
        s[1] = _scheme(IVerifier(address(pq)), falconKey);
        s[2] = _scheme(IVerifier(address(pq)), sphincsKey);
    }

    /// Starts a transaction: the VERIFY frame on the wallet.
    function _newTx(AgileWallet.Scheme[] memory current) private {
        frameTx.reset(SIG_HASH);
        frameTx.addFrame(VERIFY, address(wallet), abi.encodeCall(AgileWallet.validate, (current)));
    }

    function _signEcdsa() private {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ecdsaPrivateKey, SIG_HASH);
        frameTx.addSignature(ARBITRARY, abi.encodePacked(r, s, v));
    }

    function _signPq(bytes memory key) private {
        frameTx.addSignature(ARBITRARY, pq.sign(key, SIG_HASH));
    }

    function _signAllInitial() private {
        _signEcdsa();
        _signPq(falconKey);
        _signPq(sphincsKey);
    }

    function _addSetSchemes(AgileWallet.Scheme[] memory newSchemes) private {
        frameTx.addFrame(SENDER, address(wallet), abi.encodeCall(AgileWallet.setSchemes, (newSchemes)));
    }

    function _expectApproved() private {
        vm.expectEmit(address(wallet));
        emit Approved(EXECUTION_AND_PAYMENT);
    }

    // ---- factory ----------------------------------------------------------------------------------------------

    function test_addressIsPredictable() public view {
        assertEq(factory.walletAddress(owner), address(wallet));
        assertEq(wallet.schemesHash(), keccak256(abi.encode(_all())));
    }

    function test_canStartWithASubset() public {
        address otherOwner = address(0xB0B);
        AgileWallet.Scheme[] memory falconOnly = new AgileWallet.Scheme[](1);
        falconOnly[0] = _scheme(IVerifier(address(pq)), "another user's falcon key");

        wallet = _deploy(otherOwner, falconOnly);
        assertEq(address(wallet), factory.walletAddress(otherOwner));
        assertEq(wallet.schemesHash(), keccak256(abi.encode(falconOnly)));

        _newTx(falconOnly);
        _signPq("another user's falcon key");
        _expectApproved();
        wallet.validate(falconOnly);
    }

    function test_deployNeedsTheOwnersSignature() public {
        address otherOwner = address(0xB0B);

        frameTx.reset(SIG_HASH);
        frameTx.addProtocolSignature(address(0xBAD), 0); // someone else signed
        vm.expectRevert("owner did not sign");
        factory.deploy(otherOwner, _all());

        frameTx.reset(SIG_HASH);
        frameTx.addProtocolSignature(otherOwner, keccak256("some other message")); // not this transaction
        vm.expectRevert("owner did not sign");
        factory.deploy(otherOwner, _all());

        frameTx.reset(SIG_HASH);
        frameTx.addSignature(ARBITRARY, abi.encodePacked(otherOwner)); // unverified bytes
        vm.expectRevert("owner did not sign");
        factory.deploy(otherOwner, _all());
    }

    function test_initializeOnlyOnceAndOnlyByFactory() public {
        vm.expectRevert("already initialized");
        wallet.initialize(owner, _all());
        vm.prank(address(factory));
        vm.expectRevert("already initialized");
        wallet.initialize(owner, _all());
    }

    function test_receivesEth() public {
        (bool ok,) = address(wallet).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(wallet).balance, 1 ether);
    }

    // ---- validate ---------------------------------------------------------------------------------------------

    function test_approvesWhenEverySchemeSigns() public {
        _newTx(_all());
        _signAllInitial();
        _expectApproved();
        wallet.validate(_all());
    }

    function test_rejectsMissingSignature() public {
        _newTx(_all());
        _signEcdsa();
        _signPq(falconKey);
        vm.expectRevert();
        wallet.validate(_all());
    }

    function test_rejectsBadSignature() public {
        _newTx(_all());
        _signEcdsa();
        _signPq(sphincsKey); // Falcon's slot signed with the wrong key
        _signPq(sphincsKey);
        vm.expectRevert("bad signature");
        wallet.validate(_all());
    }

    function test_rejectsSchemesThatAreNotTheWallets() public {
        AgileWallet.Scheme[] memory forged = _all();
        forged[1] = _scheme(IVerifier(address(pq)), "someone else's key");
        _newTx(forged);
        _signEcdsa();
        _signPq("someone else's key");
        _signPq(sphincsKey);
        vm.expectRevert("wrong schemes");
        wallet.validate(forged);
    }

    function test_rejectsNonArbitrarySignature() public {
        _newTx(_all());
        frameTx.addSignature(SECP256K1, "");
        _signPq(falconKey);
        _signPq(sphincsKey);
        vm.expectRevert("not an ARBITRARY signature");
        wallet.validate(_all());
    }

    // ---- setSchemes -------------------------------------------------------------------------------------------

    function test_removingASchemeStillNeedsItsSignature() public {
        AgileWallet.Scheme[] memory falconOnly = new AgileWallet.Scheme[](1);
        falconOnly[0] = _scheme(IVerifier(address(pq)), falconKey);

        // Only the scheme that stays signs: rejected (signature 0 is checked against ECDSA, still required).
        _newTx(_all());
        _addSetSchemes(falconOnly);
        _signPq(falconKey);
        vm.expectRevert("bad signature");
        wallet.validate(_all());

        // Every scheme enabled before the change signs: approved.
        _newTx(_all());
        _addSetSchemes(falconOnly);
        _signAllInitial();
        _expectApproved();
        wallet.validate(_all());
    }

    function test_addingASchemeNeedsItsSignature() public {
        AgileWallet.Scheme[] memory withNew = new AgileWallet.Scheme[](4);
        AgileWallet.Scheme[] memory initial = _all();
        (withNew[0], withNew[1], withNew[2]) = (initial[0], initial[1], initial[2]);
        withNew[3] = _scheme(IVerifier(address(pq)), newKey);

        // Old schemes sign: rejected (the new scheme's signature is missing).
        _newTx(_all());
        _addSetSchemes(withNew);
        _signAllInitial();
        vm.expectRevert();
        wallet.validate(_all());

        // Old and new sign: approved.
        _newTx(_all());
        _addSetSchemes(withNew);
        _signAllInitial();
        _signPq(newKey);
        _expectApproved();
        wallet.validate(_all());
    }

    function test_setSchemesOnlyFromTheWallet() public {
        vm.expectRevert("only the wallet");
        wallet.setSchemes(_all());
    }

    function test_setSchemesReplacesTheList() public {
        AgileWallet.Scheme[] memory falconOnly = new AgileWallet.Scheme[](1);
        falconOnly[0] = _scheme(IVerifier(address(pq)), falconKey);
        vm.prank(address(wallet));
        wallet.setSchemes(falconOnly);
        assertEq(wallet.schemesHash(), keccak256(abi.encode(falconOnly)));
    }

    function test_setSchemesRejectsEmptyAndDuplicates() public {
        vm.startPrank(address(wallet));
        vm.expectRevert("no schemes");
        wallet.setSchemes(new AgileWallet.Scheme[](0));

        AgileWallet.Scheme[] memory twice = new AgileWallet.Scheme[](2);
        twice[0] = _scheme(ecdsa, ecdsaKey);
        twice[1] = _scheme(ecdsa, ecdsaKey);
        vm.expectRevert("duplicate scheme");
        wallet.setSchemes(twice);
    }
}
