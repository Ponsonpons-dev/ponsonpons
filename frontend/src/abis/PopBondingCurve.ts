export const PopBondingCurveAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "quoteToken_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "creatorFeeRecipient_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "factory_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "protocolFeeRecipient_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "protocolFeeShareBps_",
    "type": "uint16",
    "internalType": "uint16"
   },
   {
    "name": "cashback_",
    "type": "tuple",
    "internalType": "struct CashbackConfig",
    "components": [
     {
      "name": "mode",
      "type": "uint8",
      "internalType": "enum CashbackMode"
     },
     {
      "name": "shareBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   },
   {
    "name": "feeEscrow_",
    "type": "address",
    "internalType": "contract IPopFeeEscrow"
   },
   {
    "name": "phantomQuote_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "feeBps_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "creatorFeeBps_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "graduationThreshold_",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "buy",
  "inputs": [
   {
    "name": "quoteIn",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "minTokensOut",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "deadline",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "tokensOut",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "cashbackMode",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "enum CashbackMode"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "cashbackShareBps",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "creatorFeeBps",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "creatorFeeRecipient",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "currentSnipeTaxBps",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "exemptFromSnipeTax",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "factory",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "feeBps",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "feeEscrow",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPopFeeEscrow"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getReserves",
  "inputs": [],
  "outputs": [
   {
    "name": "quoteReserve_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "tokenReserve_",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "graduate",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "quoteOut",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "tokenOut",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "graduated",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "graduationThreshold",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "initialize",
  "inputs": [
   {
    "name": "token_",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "launchSupply",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "launchedAt",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "pendingCashback",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "pendingCreatorFees",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "pendingProtocolFees",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "phantomQuote",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "protocolFeeRecipient",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "protocolFeeShareBps",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint16",
    "internalType": "uint16"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "quoteReserve",
  "inputs": [],
  "outputs": [
   {
    "name": "quoteReserve_",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "quoteToken",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "readyToGraduate",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "realQuoteReserve",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "rescueFees",
  "inputs": [],
  "outputs": [
   {
    "name": "protocolAmount",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "creatorAmount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "reservedTokens",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "sell",
  "inputs": [
   {
    "name": "tokensIn",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "minQuoteOut",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "deadline",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "quoteOut",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "sellableTokens",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "setCreatorFeeRecipient",
  "inputs": [
   {
    "name": "newRecipient",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "snipeTaxExempt",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "exempt",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "snipeTaxSeconds",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "snipeTaxStartBps",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "sweepFees",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "token",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "tokenReserve",
  "inputs": [],
  "outputs": [
   {
    "name": "tokenReserve_",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "trackedQuote",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "trackedTokens",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "event",
  "name": "AutoGraduationFailed",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "gasRemaining",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "CreatorFeeRecipientUpdated",
  "inputs": [
   {
    "name": "previousRecipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "newRecipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "CurveBuy",
  "inputs": [
   {
    "name": "buyer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "recipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "quoteIn",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "tokensOut",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "fee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "creatorFee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "rebate",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "CurveBuyRefunded",
  "inputs": [
   {
    "name": "buyer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "refund",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "CurveCompleted",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   },
   {
    "name": "quoteOut",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "tokenOut",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "CurveSell",
  "inputs": [
   {
    "name": "seller",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "recipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "tokensIn",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "quoteOut",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "fee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "creatorFee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "rebate",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "FeesRescued",
  "inputs": [
   {
    "name": "protocolRecipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "creatorRecipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "protocolAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "creatorAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "FeesSwept",
  "inputs": [
   {
    "name": "protocolAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "creatorAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "cashbackAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "HolderRewardsPushed",
  "inputs": [
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Initialized",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "QuoteBurned",
  "inputs": [
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "SnipeTaxCharged",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "SnipeTaxExempted",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AlreadyGraduated",
  "inputs": []
 },
 {
  "type": "error",
  "name": "AlreadyInitialized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveGraduated",
  "inputs": []
 },
 {
  "type": "error",
  "name": "DeadlineExpired",
  "inputs": [
   {
    "name": "deadline",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "nowTimestamp",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "InsufficientInputAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientLiquidity",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientOutputAmount",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidFeePolicy",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidLaunchEconomics",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotFactory",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotInitialized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotReadyToGraduate",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SafeERC20FailedOperation",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "SlippageExceeded",
  "inputs": [
   {
    "name": "actual",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "minimum",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "ZeroAddress",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAmount",
  "inputs": []
 }
] as const;
