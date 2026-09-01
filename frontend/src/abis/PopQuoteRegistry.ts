export const PopQuoteRegistryAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "initialOwner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "minEthTvl_",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "graduationTargetEth_",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "REPEG_COOLDOWN",
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
  "name": "TWAP_WINDOW",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "acceptOwnership",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "adapterCount",
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
  "name": "adapters",
  "inputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPopQuoteAdapter"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "addAdapter",
  "inputs": [
   {
    "name": "adapter",
    "type": "address",
    "internalType": "contract IPopQuoteAdapter"
   }
  ],
  "outputs": [
   {
    "name": "adapterId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "bondConversion",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "pool",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "quotePerEthTwap",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "ethLaunchEconomics",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "phantomEth",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "bondThresholdEth",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getLaunchEconomics",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "phantomQuote",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "graduationThreshold",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "decimals",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "graduationTargetEth",
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
  "name": "isListed",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   }
  ],
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
  "name": "listQuote",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "adapterId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "minEthTvl",
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
  "name": "owner",
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
  "name": "pendingOwner",
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
  "name": "quotes",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "listed",
    "type": "bool",
    "internalType": "bool"
   },
   {
    "name": "paused",
    "type": "bool",
    "internalType": "bool"
   },
   {
    "name": "decimals",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "adapterId",
    "type": "uint64",
    "internalType": "uint64"
   },
   {
    "name": "phantomQuote",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "graduationThreshold",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "lastPegAt",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "renounceOwnership",
  "inputs": [],
  "outputs": [],
  "stateMutability": "pure"
 },
 {
  "type": "function",
  "name": "repegQuote",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setGraduationTargetEth",
  "inputs": [
   {
    "name": "targetEth",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setMinEthTvl",
  "inputs": [
   {
    "name": "minEthTvl_",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setQuotePaused",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "paused",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "transferOwnership",
  "inputs": [
   {
    "name": "newOwner",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "AdapterAdded",
  "inputs": [
   {
    "name": "adapterId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "adapter",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "GraduationTargetEthUpdated",
  "inputs": [
   {
    "name": "targetEth",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "MinEthTvlUpdated",
  "inputs": [
   {
    "name": "minEthTvl",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "OwnershipTransferStarted",
  "inputs": [
   {
    "name": "previousOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "newOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "OwnershipTransferred",
  "inputs": [
   {
    "name": "previousOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "newOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "QuoteListed",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "adapterId",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   },
   {
    "name": "lister",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "phantomQuote",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "graduationThreshold",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "QuotePausedUpdated",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "paused",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "QuoteRepegged",
  "inputs": [
   {
    "name": "quote",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "phantomQuote",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "graduationThreshold",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AlreadyListed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InsufficientLockedLiquidity",
  "inputs": [
   {
    "name": "principal",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "floor",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "InvalidAdapter",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidEconomics",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTarget",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotGraduated",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotListed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "OwnableInvalidOwner",
  "inputs": [
   {
    "name": "owner",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "OwnableUnauthorizedAccount",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "OwnershipCannotBeRenounced",
  "inputs": []
 },
 {
  "type": "error",
  "name": "QuotePaused",
  "inputs": []
 },
 {
  "type": "error",
  "name": "RepegCooldownActive",
  "inputs": [
   {
    "name": "availableAt",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "UnknownAdapter",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnsupportedDecimals",
  "inputs": [
   {
    "name": "decimals",
    "type": "uint8",
    "internalType": "uint8"
   }
  ]
 },
 {
  "type": "error",
  "name": "ZeroAddress",
  "inputs": []
 }
] as const;
