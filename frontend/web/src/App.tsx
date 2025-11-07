import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VoiceCommand {
  id: number;
  name: string;
  command: string;
  encryptedValue: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface UsageStats {
  totalCommands: number;
  verifiedCommands: number;
  avgResponseTime: number;
  activeUsers: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [commands, setCommands] = useState<VoiceCommand[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCommand, setCreatingCommand] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newCommandData, setNewCommandData] = useState({ name: "", command: "", value: "" });
  const [selectedCommand, setSelectedCommand] = useState<VoiceCommand | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const commandsList: VoiceCommand[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          commandsList.push({
            id: parseInt(businessId.replace('command-', '')) || Date.now(),
            name: businessData.name,
            command: businessId,
            encryptedValue: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setCommands(commandsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createCommand = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCommand(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating voice command with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const commandValue = parseInt(newCommandData.value) || 0;
      const businessId = `command-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, commandValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newCommandData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newCommandData.command) || 0,
        0,
        "Voice Command Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, {
        type: 'create',
        name: newCommandData.name,
        timestamp: Date.now(),
        value: commandValue
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Voice command created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCommandData({ name: "", command: "", value: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCommand(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      setUserHistory(prev => [...prev, {
        type: 'decrypt',
        name: businessData.name,
        timestamp: Date.now(),
        value: Number(clearValue)
      }]);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Voice command decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE System is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getUsageStats = (): UsageStats => {
    const totalCommands = commands.length;
    const verifiedCommands = commands.filter(c => c.isVerified).length;
    const avgResponseTime = commands.length > 0 
      ? commands.reduce((sum, c) => sum + c.publicValue1, 0) / commands.length 
      : 0;
    
    const uniqueUsers = new Set(commands.map(c => c.creator)).size;

    return {
      totalCommands,
      verifiedCommands,
      avgResponseTime,
      activeUsers: uniqueUsers
    };
  };

  const filteredCommands = commands.filter(command =>
    command.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    command.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsPanel = () => {
    const stats = getUsageStats();
    
    return (
      <div className="stats-panels">
        <div className="stat-panel metal">
          <div className="stat-icon">🎤</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalCommands}</div>
            <div className="stat-label">Total Commands</div>
          </div>
        </div>
        
        <div className="stat-panel metal">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verifiedCommands}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-panel metal">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{stats.avgResponseTime.toFixed(1)}ms</div>
            <div className="stat-label">Avg Response</div>
          </div>
        </div>
        
        <div className="stat-panel metal">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <div className="stat-value">{stats.activeUsers}</div>
            <div className="stat-label">Active Users</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Voice Encryption</h4>
            <p>Voice commands encrypted with FHE technology</p>
          </div>
        </div>
        
        <div className="process-arrow">→</div>
        
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Secure Upload</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        
        <div className="process-arrow">→</div>
        
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Processing</h4>
            <p>AI processes data without decryption</p>
          </div>
        </div>
        
        <div className="process-arrow">→</div>
        
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Secure Response</h4>
            <p>Results returned without exposing data</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqs = [
      {
        question: "How does FHE protect my voice data?",
        answer: "FHE allows AI to process encrypted voice commands without decrypting them, ensuring complete privacy."
      },
      {
        question: "Is my voice recorded?",
        answer: "No, only encrypted features are processed. No audio is stored."
      },
      {
        question: "What types of commands are supported?",
        answer: "Currently supports integer-based smart home controls and system commands."
      },
      {
        question: "How fast is the encryption process?",
        answer: "Near real-time encryption with optimized FHE algorithms."
      }
    ];

    return (
      <div className="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <div className="faq-question">{faq.question}</div>
              <div className="faq-answer">{faq.answer}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    return (
      <div className="history-section">
        <h3>Your Command History</h3>
        <div className="history-list">
          {userHistory.slice(-10).map((item, index) => (
            <div key={index} className="history-item">
              <div className="history-type">{item.type === 'create' ? '📝 Created' : '🔓 Decrypted'}</div>
              <div className="history-details">
                <span>{item.name}</span>
                <span>Value: {item.value}</span>
              </div>
              <div className="history-time">
                {new Date(item.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Voice Assistant 🔒</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="voice-icon">🎤</div>
            <h2>Connect to Private Voice AI</h2>
            <p>Experience truly private voice commands with FHE encryption technology</p>
            <div className="feature-grid">
              <div className="feature">
                <div className="feature-icon">🔐</div>
                <h4>Zero-Recording</h4>
                <p>No audio is ever stored or recorded</p>
              </div>
              <div className="feature">
                <div className="feature-icon">⚡</div>
                <h4>Real-time FHE</h4>
                <p>Homomorphic encryption for privacy</p>
              </div>
              <div className="feature">
                <div className="feature-icon">🤖</div>
                <h4>AI Understanding</h4>
                <p>Process commands without decryption</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Voice Encryption...</p>
        <p className="loading-note">Securing your voice privacy</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading Private Voice Assistant...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Voice Assistant 🔒</h1>
          <span>FHE-Powered Privacy</span>
        </div>
        
        <div className="header-actions">
          <div className="action-group">
            <button onClick={() => setShowHistory(!showHistory)} className="nav-btn">
              📊 History
            </button>
            <button onClick={() => setShowFAQ(!showFAQ)} className="nav-btn">
              ❓ FAQ
            </button>
            <button onClick={testAvailability} className="nav-btn">
              🔍 Test FHE
            </button>
            <button onClick={() => setShowCreateModal(true)} className="create-btn">
              🎤 New Command
            </button>
          </div>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>Voice Command Dashboard</h2>
            <div className="search-box">
              <input
                type="text"
                placeholder="Search commands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
          </div>
          
          {renderStatsPanel()}
          
          <div className="process-section">
            <h3>FHE Privacy Process</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <div className="content-grid">
          <section className="commands-section">
            <div className="section-header">
              <h3>Voice Commands</h3>
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "↻"} Refresh
              </button>
            </div>
            
            <div className="commands-list">
              {filteredCommands.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🎤</div>
                  <p>No voice commands yet</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Create First Command
                  </button>
                </div>
              ) : filteredCommands.map((command, index) => (
                <div 
                  key={index}
                  className={`command-item ${selectedCommand?.id === command.id ? "selected" : ""}`}
                  onClick={() => setSelectedCommand(command)}
                >
                  <div className="command-header">
                    <div className="command-name">{command.name}</div>
                    <div className={`command-status ${command.isVerified ? "verified" : "encrypted"}`}>
                      {command.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </div>
                  </div>
                  <div className="command-meta">
                    <span>Type: {command.publicValue1}</span>
                    <span>Created: {new Date(command.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="command-creator">
                    By: {command.creator.substring(0, 8)}...{command.creator.substring(36)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {showFAQ && (
            <aside className="sidebar">
              {renderFAQ()}
            </aside>
          )}

          {showHistory && (
            <aside className="sidebar">
              {renderUserHistory()}
            </aside>
          )}
        </div>
      </main>

      {showCreateModal && (
        <CreateCommandModal
          onSubmit={createCommand}
          onClose={() => setShowCreateModal(false)}
          creating={creatingCommand}
          commandData={newCommandData}
          setCommandData={setNewCommandData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedCommand && (
        <CommandDetailModal
          command={selectedCommand}
          onClose={() => {
            setSelectedCommand(null);
            setDecryptedData(null);
          }}
          decryptedData={decryptedData}
          setDecryptedData={setDecryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedCommand.command)}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateCommandModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  commandData: any;
  setCommandData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, commandData, setCommandData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setCommandData({ ...commandData, [name]: intValue });
    } else {
      setCommandData({ ...commandData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create Voice Command</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="security-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encrypted Voice Processing</strong>
              <p>Your voice command will be encrypted and processed without decryption</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Command Name</label>
            <input
              type="text"
              name="name"
              value={commandData.name}
              onChange={handleChange}
              placeholder="e.g., Turn on lights"
            />
          </div>
          
          <div className="form-group">
            <label>Command Type (1-10)</label>
            <input
              type="number"
              min="1"
              max="10"
              name="command"
              value={commandData.command}
              onChange={handleChange}
              placeholder="Command category"
            />
          </div>
          
          <div className="form-group">
            <label>Command Value (Integer)</label>
            <input
              type="number"
              name="value"
              value={commandData.value}
              onChange={handleChange}
              placeholder="Numeric value for command"
              step="1"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !commandData.name || !commandData.command || !commandData.value}
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Command"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CommandDetailModal: React.FC<{
  command: VoiceCommand;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ command, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) {
      setDecryptedData(null);
      return;
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Voice Command Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="command-info">
            <div className="info-row">
              <span>Command Name:</span>
              <strong>{command.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{command.creator.substring(0, 8)}...{command.creator.substring(36)}</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(command.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Command Type:</span>
              <strong>{command.publicValue1}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className="encryption-status">
              <div className={`status-indicator ${command.isVerified ? 'verified' : 'encrypted'}`}>
                {command.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
              </div>
              
              <button
                className={`decrypt-btn ${(command.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 command.isVerified ? "Verified" :
                 decryptedData !== null ? "Re-verify" : "Decrypt Command"}
              </button>
            </div>
            
            <div className="encrypted-value">
              <strong>Encrypted Value:</strong>
              <span>
                {command.isVerified ? 
                  `${command.decryptedValue} (Verified)` :
                  decryptedData !== null ?
                  `${decryptedData} (Decrypted)` :
                  "🔒 Hidden by FHE"
                }
              </span>
            </div>
          </div>
          
          <div className="privacy-note">
            <div className="privacy-icon">🛡️</div>
            <div>
              <strong>Privacy Guaranteed</strong>
              <p>Your voice command is processed using Fully Homomorphic Encryption, ensuring it's never exposed during AI processing.</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!command.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

