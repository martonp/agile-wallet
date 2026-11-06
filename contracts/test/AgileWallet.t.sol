// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgileWallet} from "../src/AgileWallet.sol";
import {AgileWalletFactory} from "../src/AgileWalletFactory.sol";
import {BreakSignal} from "../src/BreakSignal.sol";
import {IVerifier} from "../src/IVerifier.sol";
import {FrameTxMock, MockVerifier} from "./mocks/FrameTxMock.sol";

contract AgileWalletTest is Test {
    event Approved(uint256 scope);

    uint256 private constant VERIFY = 1;
    uint256 private constant SENDER = 2;
    uint256 private constant ARBITRARY = 0;
    uint256 private constant EXECUTION_AND_PAYMENT = 3;
    bytes32 private constant SIG_HASH = keccak256("frame tx sig hash");

    FrameTxMock private frameTx = new FrameTxMock();
    AgileWalletFactory private factory = new AgileWalletFactory();
    IVerifier private constant NATIVE_ECDSA = IVerifier(address(0));
    MockVerifier private pq = new MockVerifier();

    address private owner = address(0xA11CE);
    bytes private ecdsaKey = abi.encodePacked(owner);
    bytes private falconKey = "falcon public key";
    bytes private sphincsKey = "sphincs public key";
    bytes private newKey = "a future scheme's public key";

    address private cryptographer = address(0xC0DE);
    BreakSignal private signal = new BreakSignal(cryptographer, "Quantum computers break ECDSA");

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
        s[0] = _scheme(NATIVE_ECDSA, ecdsaKey);
        s[1] = _scheme(IVerifier(address(pq)), falconKey);
        s[2] = _scheme(IVerifier(address(pq)), sphincsKey);
    }

    function _none() private pure returns (AgileWallet.Rule[] memory) {}

    /// Starts a transaction: the VERIFY frame on the wallet.
    function _newTx(AgileWallet.Scheme[] memory current) private {
        _newTx(current, _none());
    }

    function _newTx(AgileWallet.Scheme[] memory current, AgileWallet.Rule[] memory rules) private {
        frameTx.reset(SIG_HASH);
        frameTx.addFrame(VERIFY, address(wallet), abi.encodeCall(AgileWallet.validate, (current, rules)));
    }

    function _signEcdsa() private {
        frameTx.addProtocolSignature(owner, 0);
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

    function _addSetRules(AgileWallet.Rule[] memory newRules) private {
        frameTx.addFrame(SENDER, address(wallet), abi.encodeCall(AgileWallet.setRules, (newRules)));
    }

    /// "Once `signal` is raised, `key` (a post-quantum scheme) must also sign."
    function _backup(bytes memory key) private view returns (AgileWallet.Rule[] memory rules) {
        rules = new AgileWallet.Rule[](1);
        rules[0] = AgileWallet.Rule(signal, _scheme(IVerifier(address(pq)), key));
    }

    /// Sets the rules as a setRules frame of an approved transaction would.
    function _subscribe(AgileWallet.Rule[] memory rules) private {
        vm.prank(address(wallet));
        wallet.setRules(rules);
    }

    function _raise() private {
        vm.prank(cryptographer);
        signal.signalBroken();
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
        wallet.validate(falconOnly, _none());
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
        wallet.validate(_all(), _none());
    }

    function test_rejectsMissingSignature() public {
        _newTx(_all());
        _signEcdsa();
        _signPq(falconKey);
        vm.expectRevert("missing signature");
        wallet.validate(_all(), _none());
    }

    function test_rejectsBadSignature() public {
        _newTx(_all());
        _signEcdsa();
        _signPq(sphincsKey); // Falcon's slot signed with the wrong key
        _signPq(sphincsKey);
        vm.expectRevert("bad signature");
        wallet.validate(_all(), _none());
    }

    function test_rejectsSchemesThatAreNotTheWallets() public {
        AgileWallet.Scheme[] memory forged = _all();
        forged[1] = _scheme(IVerifier(address(pq)), "someone else's key");
        _newTx(forged);
        _signEcdsa();
        _signPq("someone else's key");
        _signPq(sphincsKey);
        vm.expectRevert("wrong schemes");
        wallet.validate(forged, _none());
    }

    function test_rejectsNonArbitrarySignature() public {
        _newTx(_all());
        _signEcdsa();
        frameTx.addProtocolSignature(owner, 0); // in Falcon's slot
        _signPq(sphincsKey);
        vm.expectRevert("not an ARBITRARY signature");
        wallet.validate(_all(), _none());
    }

    // ---- native ECDSA -----------------------------------------------------------------------------------------

    function test_ecdsaNeedsTheProtocolSignatureOfItsAddress() public {
        _newTx(_all());
        frameTx.addSignature(ARBITRARY, abi.encodePacked(owner)); // unverified bytes
        _signPq(falconKey);
        _signPq(sphincsKey);
        vm.expectRevert("bad ECDSA signature");
        wallet.validate(_all(), _none());

        _newTx(_all());
        frameTx.addProtocolSignature(address(0xBAD), 0); // someone else signed
        _signPq(falconKey);
        _signPq(sphincsKey);
        vm.expectRevert("bad ECDSA signature");
        wallet.validate(_all(), _none());

        _newTx(_all());
        frameTx.addProtocolSignature(owner, keccak256("some other message")); // not this transaction
        _signPq(falconKey);
        _signPq(sphincsKey);
        vm.expectRevert("bad ECDSA signature");
        wallet.validate(_all(), _none());
    }

    function test_firstTransactionNeedsOneOwnerSignature() public {
        address otherOwner = address(0xB0B);
        AgileWallet.Scheme[] memory initial = _all();
        initial[0] = _scheme(NATIVE_ECDSA, abi.encodePacked(otherOwner));

        // The ECDSA scheme's entry also authorises the deployment.
        frameTx.reset(SIG_HASH);
        frameTx.addProtocolSignature(otherOwner, 0);
        _signPq(falconKey);
        _signPq(sphincsKey);
        wallet = AgileWallet(payable(factory.deploy(otherOwner, initial)));
        frameTx.addFrame(VERIFY, address(wallet), abi.encodeCall(AgileWallet.validate, (initial, _none())));
        _expectApproved();
        wallet.validate(initial, _none());
    }

    // ---- setSchemes -------------------------------------------------------------------------------------------

    function test_removingASchemeStillNeedsItsSignature() public {
        AgileWallet.Scheme[] memory falconOnly = new AgileWallet.Scheme[](1);
        falconOnly[0] = _scheme(IVerifier(address(pq)), falconKey);

        // Only the scheme that stays signs: rejected (all three are still required).
        _newTx(_all());
        _addSetSchemes(falconOnly);
        _signPq(falconKey);
        vm.expectRevert("missing signature");
        wallet.validate(_all(), _none());

        // Every scheme enabled before the change signs: approved.
        _newTx(_all());
        _addSetSchemes(falconOnly);
        _signAllInitial();
        _expectApproved();
        wallet.validate(_all(), _none());
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
        vm.expectRevert("missing signature");
        wallet.validate(_all(), _none());

        // Old and new sign: approved.
        _newTx(_all());
        _addSetSchemes(withNew);
        _signAllInitial();
        _signPq(newKey);
        _expectApproved();
        wallet.validate(_all(), _none());
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
        twice[0] = _scheme(NATIVE_ECDSA, ecdsaKey);
        twice[1] = _scheme(NATIVE_ECDSA, ecdsaKey);
        vm.expectRevert("duplicate scheme");
        wallet.setSchemes(twice);
    }

    // ---- break signals ----------------------------------------------------------------------------------------

    function test_aRuleNeedsNothingUntilItsSignalIsRaised() public {
        _subscribe(_backup(newKey));
        _newTx(_all(), _backup(newKey));
        _signAllInitial();
        _expectApproved();
        wallet.validate(_all(), _backup(newKey));
    }

    function test_onceRaisedTheBackupMustSign() public {
        _subscribe(_backup(newKey));
        _raise();

        _newTx(_all(), _backup(newKey));
        _signAllInitial();
        vm.expectRevert("missing signature");
        wallet.validate(_all(), _backup(newKey));

        _newTx(_all(), _backup(newKey));
        _signAllInitial();
        _signPq(newKey);
        _expectApproved();
        wallet.validate(_all(), _backup(newKey));
    }

    function test_aBackupThatIsAlreadyASchemeAddsNoSignature() public {
        _subscribe(_backup(falconKey));
        _raise();
        _newTx(_all(), _backup(falconKey));
        _signAllInitial();
        _expectApproved();
        wallet.validate(_all(), _backup(falconKey));
    }

    function test_rejectsRulesThatAreNotTheWallets() public {
        _subscribe(_backup(newKey));
        _newTx(_all());
        _signAllInitial();
        vm.expectRevert("wrong rules"); // hiding the rule
        wallet.validate(_all(), _none());
    }

    function test_droppingARaisedRuleStillNeedsItsBackup() public {
        _subscribe(_backup(newKey));
        _raise();

        _newTx(_all(), _backup(newKey));
        _addSetRules(_none());
        _signAllInitial();
        vm.expectRevert("missing signature");
        wallet.validate(_all(), _backup(newKey));

        _newTx(_all(), _backup(newKey));
        _addSetRules(_none());
        _signAllInitial();
        _signPq(newKey);
        _expectApproved();
        wallet.validate(_all(), _backup(newKey));
    }

    function test_subscribingNeedsTheBackupsSignature() public {
        _newTx(_all());
        _addSetRules(_backup(newKey));
        _signAllInitial();
        vm.expectRevert("missing signature");
        wallet.validate(_all(), _none());

        _newTx(_all());
        _addSetRules(_backup(newKey));
        _signAllInitial();
        _signPq(newKey);
        _expectApproved();
        wallet.validate(_all(), _none());
    }

    /// Required order: the schemes, the raised backups, then what setSchemes and setRules frames add.
    function test_raisedBackupsComeBeforeAddedSchemes() public {
        _subscribe(_backup(newKey));
        _raise();
        AgileWallet.Scheme[] memory withAnother = new AgileWallet.Scheme[](4);
        AgileWallet.Scheme[] memory initial = _all();
        (withAnother[0], withAnother[1], withAnother[2]) = (initial[0], initial[1], initial[2]);
        withAnother[3] = _scheme(IVerifier(address(pq)), "another scheme's key");

        _newTx(_all(), _backup(newKey));
        _addSetSchemes(withAnother);
        _signAllInitial();
        _signPq(newKey);
        _signPq("another scheme's key");
        _expectApproved();
        wallet.validate(_all(), _backup(newKey));
    }

    function test_setRulesOnlyFromTheWallet() public {
        vm.expectRevert("only the wallet");
        wallet.setRules(_backup(newKey));
    }

    function test_setRulesStoresTheHashOrZero() public {
        _subscribe(_backup(newKey));
        assertEq(wallet.rulesHash(), keccak256(abi.encode(_backup(newKey))));
        _subscribe(_none());
        assertEq(wallet.rulesHash(), bytes32(0));
    }

    function test_setRulesRejectsSignalsThatCantAnswer() public {
        AgileWallet.Rule[] memory dead = _backup(newKey);
        dead[0].signal = BreakSignal(address(0xDEAD)); // no code: validation could never call it
        vm.prank(address(wallet));
        vm.expectRevert(); // Solidity's no-code check reverts without a reason
        wallet.setRules(dead);
    }

    function test_onlyRaisedRulesAddTheirBackups() public {
        BreakSignal other = new BreakSignal(cryptographer, "Something else breaks");
        AgileWallet.Rule[] memory rules = new AgileWallet.Rule[](2);
        rules[0] = AgileWallet.Rule(other, _scheme(IVerifier(address(pq)), "unraised backup"));
        rules[1] = _backup(newKey)[0];
        _subscribe(rules);
        _raise();

        _newTx(_all(), rules);
        _signAllInitial();
        _signPq(newKey);
        _expectApproved();
        wallet.validate(_all(), rules);

        // Reordered: not the wallet's rules.
        (rules[0], rules[1]) = (rules[1], rules[0]);
        _newTx(_all(), rules);
        _signAllInitial();
        _signPq(newKey);
        vm.expectRevert("wrong rules");
        wallet.validate(_all(), rules);
    }

    function test_anEcdsaBackupNeedsTheProtocolSignature() public {
        AgileWallet.Scheme[] memory falconOnly = new AgileWallet.Scheme[](1);
        falconOnly[0] = _scheme(IVerifier(address(pq)), falconKey);
        vm.prank(address(wallet));
        wallet.setSchemes(falconOnly);
        AgileWallet.Rule[] memory rules = new AgileWallet.Rule[](1);
        rules[0] = AgileWallet.Rule(signal, _scheme(NATIVE_ECDSA, ecdsaKey));
        _subscribe(rules);
        _raise();

        _newTx(falconOnly, rules);
        _signPq(falconKey);
        vm.expectRevert("missing signature");
        wallet.validate(falconOnly, rules);

        _newTx(falconOnly, rules);
        _signPq(falconKey);
        _signEcdsa();
        _expectApproved();
        wallet.validate(falconOnly, rules);
    }

    function test_droppingAnUnraisedRuleNeedsOnlyTheSchemes() public {
        _subscribe(_backup(newKey));
        _newTx(_all(), _backup(newKey));
        _addSetRules(_none());
        _signAllInitial();
        _expectApproved();
        wallet.validate(_all(), _backup(newKey));
    }

    /// Frames add their schemes in frame order, whichever function they call.
    function test_addedSchemesFollowFrameOrder() public {
        AgileWallet.Scheme[] memory withAnother = new AgileWallet.Scheme[](4);
        AgileWallet.Scheme[] memory initial = _all();
        (withAnother[0], withAnother[1], withAnother[2]) = (initial[0], initial[1], initial[2]);
        withAnother[3] = _scheme(IVerifier(address(pq)), "another scheme's key");

        _newTx(_all());
        _addSetRules(_backup(newKey));
        _addSetSchemes(withAnother);
        _signAllInitial();
        _signPq(newKey);
        _signPq("another scheme's key");
        _expectApproved();
        wallet.validate(_all(), _none());
    }
}
