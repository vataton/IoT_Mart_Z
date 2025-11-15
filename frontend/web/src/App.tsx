import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface SensorData {
  id: string;
  name: string;
  sensorType: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  price: number;
  status: 'available' | 'sold';
}

interface DataStats {
  totalSensors: number;
  availableData: number;
  totalSales: number;
  avgPrice: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [sensorData, setSensorData] = useState<SensorData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSensor, setCreatingSensor] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSensorData, setNewSensorData] = useState({ 
    name: "", 
    sensorType: "temperature", 
    value: "", 
    description: "",
    price: ""
  });
  const [selectedSensor, setSelectedSensor] = useState<SensorData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [stats, setStats] = useState<DataStats>({
    totalSensors: 0,
    availableData: 0,
    totalSales: 0,
    avgPrice: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
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
        console.error('加载数据失败:', error);
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
      const sensorList: SensorData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          sensorList.push({
            id: businessId,
            name: businessData.name,
            sensorType: "IoT Sensor",
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            price: Number(businessData.publicValue2) || 0,
            status: 'available'
          });
        } catch (e) {
          console.error('加载传感器数据错误:', e);
        }
      }
      
      setSensorData(sensorList);
      updateStats(sensorList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: SensorData[]) => {
    const totalSensors = data.length;
    const availableData = data.filter(d => d.status === 'available').length;
    const totalSales = data.filter(d => d.status === 'sold').length;
    const avgPrice = data.length > 0 ? data.reduce((sum, d) => sum + d.price, 0) / data.length : 0;
    
    setStats({ totalSensors, availableData, totalSales, avgPrice });
  };

  const createSensorData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSensor(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE创建传感器数据..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const sensorValue = parseInt(newSensorData.value) || 0;
      const businessId = `sensor-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, sensorValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSensorData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newSensorData.price) || 0,
        0,
        newSensorData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, {
        type: 'create',
        id: businessId,
        name: newSensorData.name,
        timestamp: Date.now(),
        value: sensorValue
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "传感器数据创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSensorData({ name: "", sensorType: "temperature", value: "", description: "", price: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户拒绝交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSensor(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
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
          message: "数据已在链上验证" 
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setUserHistory(prev => [...prev, {
        type: 'decrypt',
        id: businessId,
        name: businessData.name,
        timestamp: Date.now(),
        value: Number(clearValue)
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
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
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "合约可用性检查成功!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "可用性检查失败" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel metal-panel">
          <div className="stat-icon">📡</div>
          <div className="stat-content">
            <h3>总传感器数</h3>
            <div className="stat-value">{stats.totalSensors}</div>
            <div className="stat-trend">+{stats.availableData} 可用</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>平均价格</h3>
            <div className="stat-value">{stats.avgPrice.toFixed(2)} ETH</div>
            <div className="stat-trend">FHE加密数据</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">🛒</div>
          <div className="stat-content">
            <h3>总交易数</h3>
            <div className="stat-value">{stats.totalSales}</div>
            <div className="stat-trend">隐私保护交易</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>FHE验证</h3>
            <div className="stat-value">{sensorData.filter(d => d.isVerified).length}</div>
            <div className="stat-trend">链上验证数据</div>
          </div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="history-section">
        <h3>用户操作历史</h3>
        <div className="history-list">
          {userHistory.slice(-5).map((record, index) => (
            <div key={index} className="history-item">
              <div className="history-type">{record.type === 'create' ? '创建' : '解密'}</div>
              <div className="history-name">{record.name}</div>
              <div className="history-value">{record.value}</div>
              <div className="history-time">{new Date(record.timestamp).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>数据加密</h4>
            <p>传感器数据使用Zama FHE加密 🔐</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密数据存储在区块链上</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>同态计算</h4>
            <p>买家可计算统计值而不解密</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>链上验证</h4>
            <p>使用FHE.checkSignatures验证解密</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>IoT Mart Z 🔐</h1>
            <span>FHE物联网数据隐私市场</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包进入隐私数据市场</h2>
            <p>连接您的钱包来访问加密的物联网数据市场，体验完全隐私保护的数据交易</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>点击上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统将自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始加密数据交易</p>
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
        <p>初始化FHE加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密数据市场...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>IoT Mart Z 🔐</h1>
          <span>FHE物联网数据隐私市场</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + 出售数据
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn metal-btn"
          >
            检查合约
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>物联网数据市场概览</h2>
          {renderStatsPanel()}
          
          <div className="fhe-info-panel metal-panel">
            <h3>FHE 🔐 隐私保护流程</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="data-section">
          <div className="section-header">
            <h2>可用传感器数据</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "刷新数据"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            {sensorData.length === 0 ? (
              <div className="no-data">
                <p>暂无传感器数据</p>
                <button 
                  className="create-btn metal-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  出售第一条数据
                </button>
              </div>
            ) : sensorData.map((sensor, index) => (
              <div 
                className={`data-item metal-panel ${selectedSensor?.id === sensor.id ? "selected" : ""} ${sensor.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedSensor(sensor)}
              >
                <div className="data-header">
                  <div className="data-title">{sensor.name}</div>
                  <div className="data-price">{sensor.price} ETH</div>
                </div>
                <div className="data-meta">
                  <span>类型: {sensor.sensorType}</span>
                  <span>创建: {new Date(sensor.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="data-status">
                  状态: {sensor.isVerified ? "✅ 已验证" : "🔓 待验证"}
                  {sensor.isVerified && sensor.decryptedValue && (
                    <span className="verified-value">数值: {sensor.decryptedValue}</span>
                  )}
                </div>
                <div className="data-creator">创建者: {sensor.creator.substring(0, 6)}...{sensor.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
        
        {renderUserHistory()}
      </div>
      
      {showCreateModal && (
        <CreateSensorModal 
          onSubmit={createSensorData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSensor} 
          sensorData={newSensorData} 
          setSensorData={setNewSensorData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedSensor && (
        <SensorDetailModal 
          sensor={selectedSensor} 
          onClose={() => setSelectedSensor(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedSensor.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateSensorModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  sensorData: any;
  setSensorData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, sensorData, setSensorData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'value' || name === 'price') {
      const intValue = value.replace(/[^\d]/g, '');
      setSensorData({ ...sensorData, [name]: intValue });
    } else {
      setSensorData({ ...sensorData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-panel">
        <div className="modal-header">
          <h2>出售传感器数据</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>传感器数值将使用Zama FHE加密（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>数据名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={sensorData.name} 
              onChange={handleChange} 
              placeholder="输入数据名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>传感器类型</label>
            <select name="sensorType" value={sensorData.sensorType} onChange={handleChange}>
              <option value="temperature">温度传感器</option>
              <option value="humidity">湿度传感器</option>
              <option value="pressure">压力传感器</option>
              <option value="motion">运动传感器</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>传感器数值（整数） *</label>
            <input 
              type="number" 
              name="value" 
              value={sensorData.value} 
              onChange={handleChange} 
              placeholder="输入传感器数值..." 
              step="1"
              min="0"
            />
            <div className="data-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>价格（ETH） *</label>
            <input 
              type="number" 
              name="price" 
              value={sensorData.price} 
              onChange={handleChange} 
              placeholder="输入价格..." 
              step="0.001"
              min="0"
            />
            <div className="data-label">公开数据</div>
          </div>
          
          <div className="form-group">
            <label>数据描述</label>
            <textarea 
              name="description" 
              value={sensorData.description} 
              onChange={handleChange} 
              placeholder="描述传感器数据..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !sensorData.name || !sensorData.value || !sensorData.price} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建数据"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SensorDetailModal: React.FC<{
  sensor: SensorData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ sensor, onClose, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal metal-panel">
        <div className="modal-header">
          <h2>传感器数据详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="sensor-info">
            <div className="info-item">
              <span>数据名称:</span>
              <strong>{sensor.name}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{sensor.creator.substring(0, 6)}...{sensor.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(sensor.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>价格:</span>
              <strong>{sensor.price} ETH</strong>
            </div>
            <div className="info-item">
              <span>传感器类型:</span>
              <strong>{sensor.sensorType}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密传感器数据</h3>
            
            <div className="data-row">
              <div className="data-label">传感器数值:</div>
              <div className="data-value">
                {sensor.isVerified && sensor.decryptedValue ? 
                  `${sensor.decryptedValue} (链上已验证)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${sensor.isVerified ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : sensor.isVerified ? (
                  "✅ 已验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 隐私保护</strong>
                <p>数据在链上加密存储。点击"验证解密"进行离线解密和链上验证。</p>
              </div>
            </div>
          </div>
          
          {sensor.isVerified && (
            <div className="decrypted-section">
              <h3>解密数据</h3>
              <div className="decrypted-value">
                <span>传感器数值:</span>
                <strong>{sensor.decryptedValue}</strong>
                <span className="data-badge verified">链上验证</span>
              </div>
              <div className="data-description">
                <h4>数据描述</h4>
                <p>{sensor.description || "暂无描述"}</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">关闭</button>
          {!sensor.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

