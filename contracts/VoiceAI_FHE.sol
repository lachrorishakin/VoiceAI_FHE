pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VoiceCommandProcessor is ZamaEthereumConfig {
    struct EncryptedCommand {
        euint32 encryptedIntent;
        uint256 timestamp;
        address sender;
        bool executed;
        uint32 decryptedIntent;
    }

    mapping(uint256 => EncryptedCommand) public commands;
    uint256[] public commandIds;

    event CommandReceived(uint256 indexed commandId, address indexed sender);
    event CommandExecuted(uint256 indexed commandId, uint32 decryptedIntent);

    constructor() ZamaEthereumConfig() {}

    function submitEncryptedCommand(
        externalEuint32 encryptedIntent,
        bytes calldata inputProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedIntent, inputProof)), "Invalid encrypted input");

        uint256 commandId = block.timestamp;
        commands[commandId] = EncryptedCommand({
            encryptedIntent: FHE.fromExternal(encryptedIntent, inputProof),
            timestamp: block.timestamp,
            sender: msg.sender,
            executed: false,
            decryptedIntent: 0
        });

        FHE.allowThis(commands[commandId].encryptedIntent);
        FHE.makePubliclyDecryptable(commands[commandId].encryptedIntent);

        commandIds.push(commandId);
        emit CommandReceived(commandId, msg.sender);
    }

    function executeCommand(
        uint256 commandId,
        bytes memory abiEncodedClearIntent,
        bytes memory decryptionProof
    ) external {
        require(commands[commandId].timestamp > 0, "Command does not exist");
        require(!commands[commandId].executed, "Command already executed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(commands[commandId].encryptedIntent);

        FHE.checkSignatures(cts, abiEncodedClearIntent, decryptionProof);

        uint32 decodedIntent = abi.decode(abiEncodedClearIntent, (uint32));
        commands[commandId].decryptedIntent = decodedIntent;
        commands[commandId].executed = true;

        emit CommandExecuted(commandId, decodedIntent);
    }

    function getEncryptedCommand(uint256 commandId) external view returns (euint32) {
        require(commands[commandId].timestamp > 0, "Command does not exist");
        return commands[commandId].encryptedIntent;
    }

    function getCommandDetails(uint256 commandId) external view returns (
        uint256 timestamp,
        address sender,
        bool executed,
        uint32 decryptedIntent
    ) {
        require(commands[commandId].timestamp > 0, "Command does not exist");
        EncryptedCommand storage cmd = commands[commandId];
        return (cmd.timestamp, cmd.sender, cmd.executed, cmd.decryptedIntent);
    }

    function getAllCommandIds() external view returns (uint256[] memory) {
        return commandIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

