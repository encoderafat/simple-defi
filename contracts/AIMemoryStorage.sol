// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ================================================================
// CORE MEMORY STORAGE CONTRACT
// ================================================================

/**
 * @title AIMemoryStorage
 * @dev Stores critical user patterns and preferences on-chain
 * @notice This contract stores encrypted user data and learning patterns
 */
contract AIMemoryStorage is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // Events
    event UserRegistered(address indexed user, bytes32 indexed profileHash);
    event PatternStored(address indexed user, bytes32 indexed patternHash, uint8 patternType);
    event StrategyUpdated(address indexed user, bytes32 indexed strategyHash, uint256 performance);
    event MemoryDecayed(address indexed user, uint256 patternsDecayed);
    
    // Structs
    struct UserProfile {
        bytes32 profileHash;        // Hash of off-chain profile data
        uint256 interactionCount;   // Total interactions
        uint256 successfulTrades;   // Successful trade count
        uint256 totalVolume;        // Total volume in wei
        uint256 lastActive;         // Last activity timestamp
        bool isActive;              // Account status
    }
    
    struct LearningPattern {
        bytes32 patternHash;        // Hash of pattern data
        uint8 patternType;          // 1=timing, 2=risk, 3=preference, 4=strategy
        uint256 confidence;         // Confidence score (0-1000)
        uint256 sampleSize;         // Number of samples
        uint256 successRate;        // Success rate (0-1000)
        uint256 lastUpdated;        // Last update timestamp
        uint256 decayFactor;        // Decay factor (0-1000)
    }
    
    struct Strategy {
        bytes32 strategyHash;       // Hash of strategy parameters
        uint256 totalExecutions;    // Total executions
        uint256 successfulExecutions; // Successful executions
        int256 totalProfitLoss;     // Total P&L in wei
        uint256 lastExecuted;       // Last execution timestamp
        bool isActive;              // Strategy status
    }
    
    // State variables
    mapping(address => UserProfile) public userProfiles;
    mapping(address => mapping(bytes32 => LearningPattern)) public userPatterns;
    mapping(address => mapping(bytes32 => Strategy)) public userStrategies;
    mapping(address => bytes32[]) public userPatternList;
    mapping(address => bytes32[]) public userStrategyList;
    
    // Configuration
    uint256 public constant DECAY_PERIOD = 30 days;
    uint256 public constant MIN_CONFIDENCE = 100; // 10%
    uint256 public constant MAX_PATTERNS_PER_USER = 50;
    uint256 public memoryStorageFee = 0.001 ether;
    
    // Modifiers
    modifier onlyRegisteredUser() {
        require(userProfiles[msg.sender].isActive, "User not registered");
        _;
    }
    
    modifier validPatternType(uint8 _type) {
        require(_type >= 1 && _type <= 4, "Invalid pattern type");
        _;
    }

    constructor() Ownable(msg.sender) {
    // The Ownable constructor is now called with the deployer's address
    }
    
    // ================================================================
    // USER MANAGEMENT
    // ================================================================
    
    /**
     * @dev Register a new user with initial profile
     * @param _profileHash Hash of encrypted profile data stored off-chain
     */
    function registerUser(bytes32 _profileHash) external payable {
        require(msg.value >= memoryStorageFee, "Insufficient fee");
        require(!userProfiles[msg.sender].isActive, "User already registered");
        
        userProfiles[msg.sender] = UserProfile({
            profileHash: _profileHash,
            interactionCount: 0,
            successfulTrades: 0,
            totalVolume: 0,
            lastActive: block.timestamp,
            isActive: true
        });
        
        emit UserRegistered(msg.sender, _profileHash);
    }
    
    /**
     * @dev Update user profile hash
     * @param _newProfileHash New hash of updated profile data
     */
    function updateProfile(bytes32 _newProfileHash) external onlyRegisteredUser {
        userProfiles[msg.sender].profileHash = _newProfileHash;
        userProfiles[msg.sender].lastActive = block.timestamp;
    }
    
    /**
     * @dev Record user interaction (called by DeFi protocols)
     * @param _volumeWei Transaction volume in wei
     * @param _wasSuccessful Whether the transaction was successful
     */
    function recordInteraction(uint256 _volumeWei, bool _wasSuccessful) external onlyRegisteredUser {
        UserProfile storage profile = userProfiles[msg.sender];
        profile.interactionCount++;
        profile.totalVolume += _volumeWei;
        profile.lastActive = block.timestamp;
        
        if (_wasSuccessful) {
            profile.successfulTrades++;
        }
    }
    
    // ================================================================
    // PATTERN STORAGE & LEARNING
    // ================================================================
    
    /**
     * @dev Store a learning pattern for a user
     * @param _patternHash Hash of pattern data
     * @param _patternType Type of pattern (1-4)
     * @param _confidence Initial confidence score (0-1000)
     * @param _sampleSize Number of samples this pattern is based on
     */
    function storePattern(
        bytes32 _patternHash,
        uint8 _patternType,
        uint256 _confidence,
        uint256 _sampleSize
    ) external onlyRegisteredUser validPatternType(_patternType) {
        require(_confidence <= 1000, "Confidence too high");
        require(_sampleSize > 0, "Sample size must be positive");
        require(userPatternList[msg.sender].length < MAX_PATTERNS_PER_USER, "Too many patterns");
        
        // If pattern doesn't exist, add to list
        if (userPatterns[msg.sender][_patternHash].patternHash == bytes32(0)) {
            userPatternList[msg.sender].push(_patternHash);
        }
        
        userPatterns[msg.sender][_patternHash] = LearningPattern({
            patternHash: _patternHash,
            patternType: _patternType,
            confidence: _confidence,
            sampleSize: _sampleSize,
            successRate: 500, // Default 50%
            lastUpdated: block.timestamp,
            decayFactor: 1000 // No decay initially
        });
        
        emit PatternStored(msg.sender, _patternHash, _patternType);
    }
    
    /**
     * @dev Update pattern performance based on outcomes
     * @param _patternHash Hash of the pattern to update
     * @param _newSuccessRate New success rate (0-1000)
     * @param _additionalSamples Additional samples collected
     */
    function updatePattern(
        bytes32 _patternHash,
        uint256 _newSuccessRate,
        uint256 _additionalSamples
    ) external onlyRegisteredUser {
        require(_newSuccessRate <= 1000, "Success rate too high");
        
        LearningPattern storage pattern = userPatterns[msg.sender][_patternHash];
        require(pattern.patternHash != bytes32(0), "Pattern not found");
        
        pattern.successRate = _newSuccessRate;
        pattern.sampleSize += _additionalSamples;
        pattern.lastUpdated = block.timestamp;
        
        // Recalculate confidence based on sample size and success rate
        pattern.confidence = calculateConfidence(pattern.sampleSize, _newSuccessRate);
    }
    
    /**
     * @dev Apply decay to old patterns
     * @param _user User address to decay patterns for
     */
    function decayPatterns(address _user) external {
        bytes32[] storage patterns = userPatternList[_user];
        uint256 decayedCount = 0;
        
        for (uint256 i = 0; i < patterns.length; i++) {
            LearningPattern storage pattern = userPatterns[_user][patterns[i]];
            
            if (block.timestamp - pattern.lastUpdated > DECAY_PERIOD) {
                // Apply decay factor
                pattern.decayFactor = (pattern.decayFactor * 90) / 100; // 10% decay
                
                // Remove pattern if confidence too low
                if (pattern.confidence < MIN_CONFIDENCE) {
                    delete userPatterns[_user][patterns[i]];
                    // Remove from array by swapping with last element
                    patterns[i] = patterns[patterns.length - 1];
                    patterns.pop();
                    i--; // Adjust index
                    decayedCount++;
                }
            }
        }
        
        if (decayedCount > 0) {
            emit MemoryDecayed(_user, decayedCount);
        }
    }
    
    // ================================================================
    // STRATEGY MANAGEMENT
    // ================================================================
    
    /**
     * @dev Store or update a trading strategy
     * @param _strategyHash Hash of strategy parameters
     * @param _totalExecutions Total number of executions
     * @param _successfulExecutions Number of successful executions
     * @param _totalProfitLoss Total profit/loss in wei
     */
    function updateStrategy(
        bytes32 _strategyHash,
        uint256 _totalExecutions,
        uint256 _successfulExecutions,
        int256 _totalProfitLoss
    ) external onlyRegisteredUser {
        require(_successfulExecutions <= _totalExecutions, "Invalid execution counts");
        
        // If strategy doesn't exist, add to list
        if (userStrategies[msg.sender][_strategyHash].strategyHash == bytes32(0)) {
            userStrategyList[msg.sender].push(_strategyHash);
        }
        
        userStrategies[msg.sender][_strategyHash] = Strategy({
            strategyHash: _strategyHash,
            totalExecutions: _totalExecutions,
            successfulExecutions: _successfulExecutions,
            totalProfitLoss: _totalProfitLoss,
            lastExecuted: block.timestamp,
            isActive: true
        });
        
        uint256 performance = _totalExecutions > 0 ? 
            (_successfulExecutions * 1000) / _totalExecutions : 0;
        
        emit StrategyUpdated(msg.sender, _strategyHash, performance);
    }
    
    /**
     * @dev Deactivate a strategy
     * @param _strategyHash Hash of strategy to deactivate
     */
    function deactivateStrategy(bytes32 _strategyHash) external onlyRegisteredUser {
        userStrategies[msg.sender][_strategyHash].isActive = false;
    }
    
    // ================================================================
    // UTILITY FUNCTIONS
    // ================================================================
    
    /**
     * @dev Calculate confidence score based on sample size and success rate
     * @param _sampleSize Number of samples
     * @param _successRate Success rate (0-1000)
     * @return Confidence score (0-1000)
     */
    function calculateConfidence(uint256 _sampleSize, uint256 _successRate) 
        internal 
        pure 
        returns (uint256) 
    {
        if (_sampleSize == 0) return 0;
        
        // Confidence increases with sample size and success rate
        uint256 sampleFactor = _sampleSize > 10 ? 1000 : (_sampleSize * 100);
        uint256 successFactor = _successRate > 500 ? _successRate : 500;
        
        return (sampleFactor * successFactor) / 1000;
    }
    
    /**
     * @dev Get user's pattern count
     * @param _user User address
     * @return Number of patterns stored
     */
    function getUserPatternCount(address _user) external view returns (uint256) {
        return userPatternList[_user].length;
    }
    
    /**
     * @dev Get user's strategy count
     * @param _user User address
     * @return Number of strategies stored
     */
    function getUserStrategyCount(address _user) external view returns (uint256) {
        return userStrategyList[_user].length;
    }
    
    /**
     * @dev Get user's pattern hashes
     * @param _user User address
     * @return Array of pattern hashes
     */
    function getUserPatterns(address _user) external view returns (bytes32[] memory) {
        return userPatternList[_user];
    }
    
    /**
     * @dev Get user's strategy hashes
     * @param _user User address
     * @return Array of strategy hashes
     */
    function getUserStrategies(address _user) external view returns (bytes32[] memory) {
        return userStrategyList[_user];
    }
    
    // ================================================================
    // ADMIN FUNCTIONS
    // ================================================================
    
    /**
     * @dev Update memory storage fee
     * @param _newFee New fee in wei
     */
    function updateMemoryStorageFee(uint256 _newFee) external onlyOwner {
        memoryStorageFee = _newFee;
    }
    
    /**
     * @dev Withdraw accumulated fees
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @dev Emergency pause user account
     * @param _user User to pause
     */
    function pauseUser(address _user) external onlyOwner {
        userProfiles[_user].isActive = false;
    }
    
    /**
     * @dev Reactivate user account
     * @param _user User to reactivate
     */
    function reactivateUser(address _user) external onlyOwner {
        userProfiles[_user].isActive = true;
    }
}
