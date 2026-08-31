export const PopLaunchFactoryAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "initialOwner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "poolManager_",
    "type": "address",
    "internalType": "contract IPoolManager"
   },
   {
    "name": "positionManager_",
    "type": "address",
    "internalType": "contract IPositionManager"
   },
   {
    "name": "permit2_",
    "type": "address",
    "internalType": "contract IAllowanceTransfer"
   },
   {
    "name": "locker_",
    "type": "address",
    "internalType": "contract PopLocker"
   },
   {
    "name": "hook_",
    "type": "address",
    "internalType": "contract PopHook"
   },
   {
    "name": "feeEscrow_",
    "type": "address",
    "internalType": "contract IPopFeeEscrow"
   },
   {
    "name": "quoteRegistry_",
    "type": "address",
    "internalType": "contract IPopQuoteRegistry"
   },
   {
    "name": "initialLaunchFee",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "GRADUATION_RESCUE_DELAY",
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
  "name": "acceptOwnership",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "addLaunchConfig",
  "inputs": [
   {
    "name": "config",
    "type": "tuple",
    "internalType": "struct PopLaunchFactory.LaunchConfig",
    "components": [
     {
      "name": "supply",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "curveFeeBps",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "poolFee",
      "type": "uint24",
      "internalType": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24",
      "internalType": "int24"
     },
     {
      "name": "enabled",
      "type": "bool",
      "internalType": "bool"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "canLaunch",
  "inputs": [
   {
    "name": "launcher",
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
  "name": "createGraduatedPool",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "positionId",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
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
  "name": "getLaunchConfig",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct PopLaunchFactory.LaunchConfig",
    "components": [
     {
      "name": "supply",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "curveFeeBps",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "poolFee",
      "type": "uint24",
      "internalType": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24",
      "internalType": "int24"
     },
     {
      "name": "enabled",
      "type": "bool",
      "internalType": "bool"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getLaunchFeePolicy",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct FeePolicySnapshot",
    "components": [
     {
      "name": "protocolFeeRecipient",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "protocolFeeShareBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "hookFeeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "maxInternalPriceImpactBps",
      "type": "uint16",
      "internalType": "uint16"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getLaunchedToken",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct IPopLaunchFactory.LaunchedToken",
    "components": [
     {
      "name": "token",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "curve",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "deployer",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "creatorFeeRecipient",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "quoteToken",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "graduationThreshold",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "poolFee",
      "type": "uint24",
      "internalType": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24",
      "internalType": "int24"
     },
     {
      "name": "creatorFeeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "cashback",
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
      "name": "phase",
      "type": "uint8",
      "internalType": "enum GraduationPhase"
     },
     {
      "name": "sweptQuote",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "sweptTokens",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "sweptAt",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "exists",
      "type": "bool",
      "internalType": "bool"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "graduate",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "graduationExecutor",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PopGraduationExecutor"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "graduationGuard",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PopGraduationGuard"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "hook",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PopHook"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "launchConfigCount",
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
  "name": "launchDeployer",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PopLaunchDeployer"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "launchEnabled",
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
  "name": "launchFee",
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
  "name": "launchToken",
  "inputs": [
   {
    "name": "params",
    "type": "tuple",
    "internalType": "struct PopLaunchFactory.TokenParams",
    "components": [
     {
      "name": "name",
      "type": "string",
      "internalType": "string"
     },
     {
      "name": "symbol",
      "type": "string",
      "internalType": "string"
     },
     {
      "name": "logo",
      "type": "string",
      "internalType": "string"
     },
     {
      "name": "description",
      "type": "string",
      "internalType": "string"
     },
     {
      "name": "socials",
      "type": "tuple",
      "internalType": "struct PopLaunchToken.Socials",
      "components": [
       {
        "name": "twitter",
        "type": "string",
        "internalType": "string"
       },
       {
        "name": "telegram",
        "type": "string",
        "internalType": "string"
       },
       {
        "name": "discord",
        "type": "string",
        "internalType": "string"
       },
       {
        "name": "website",
        "type": "string",
        "internalType": "string"
       },
       {
        "name": "farcaster",
        "type": "string",
        "internalType": "string"
       }
      ]
     },
     {
      "name": "creatorFeeRecipient",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "creatorFeeBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "cashback",
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
      "name": "expectedEconomics",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "salt",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   },
   {
    "name": "launchConfigId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "quoteToken",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "devBuyQuote",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "devBuyMinTokens",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "snipeTaxExemptions",
    "type": "address[]",
    "internalType": "address[]"
   }
  ],
  "outputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "curve",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "locker",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PopLocker"
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
  "name": "permit2",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IAllowanceTransfer"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "poolManager",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPoolManager"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "positionManager",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPositionManager"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "previewLaunchEconomics",
  "inputs": [
   {
    "name": "launchConfigId",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "quoteToken",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "quoteRegistry",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IPopQuoteRegistry"
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
  "name": "rescueCurveFees",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "rescueSweptGraduation",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setGraduationExecutor",
  "inputs": [
   {
    "name": "executor",
    "type": "address",
    "internalType": "contract PopGraduationExecutor"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setLaunchDeployer",
  "inputs": [
   {
    "name": "deployer",
    "type": "address",
    "internalType": "contract PopLaunchDeployer"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setLaunchEnabled",
  "inputs": [
   {
    "name": "enabled",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setLaunchFee",
  "inputs": [
   {
    "name": "newLaunchFee",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setSnipeTaxSeconds",
  "inputs": [
   {
    "name": "secondsWindow",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setSnipeTaxStartBps",
  "inputs": [
   {
    "name": "bps",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "setWhitelistedLauncher",
  "inputs": [
   {
    "name": "launcher",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "enabled",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
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
  "name": "transferCreatorFeeRecipient",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
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
  "type": "function",
  "name": "updateLaunchConfig",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "config",
    "type": "tuple",
    "internalType": "struct PopLaunchFactory.LaunchConfig",
    "components": [
     {
      "name": "supply",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "curveFeeBps",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "poolFee",
      "type": "uint24",
      "internalType": "uint24"
     },
     {
      "name": "tickSpacing",
      "type": "int24",
      "internalType": "int24"
     },
     {
      "name": "enabled",
      "type": "bool",
      "internalType": "bool"
     }
    ]
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "whitelistedLaunchers",
  "inputs": [
   {
    "name": "launcher",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "enabled",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "event",
  "name": "CreatorFeeRecipientUpdated",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
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
  "name": "DevBuyExecuted",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "deployer",
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
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "GraduationExecutorSet",
  "inputs": [
   {
    "name": "executor",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "GraduationTokensPermanentlyLocked",
  "inputs": [
   {
    "name": "token",
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
  "name": "LaunchConfigAdded",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LaunchConfigUpdated",
  "inputs": [
   {
    "name": "id",
    "type": "uint256",
    "indexed": true,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LaunchDeployerSet",
  "inputs": [
   {
    "name": "deployer",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LaunchEnabledUpdated",
  "inputs": [
   {
    "name": "enabled",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LaunchFeeUpdated",
  "inputs": [
   {
    "name": "launchFee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LaunchGraduationRescued",
  "inputs": [
   {
    "name": "token",
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
    "name": "quoteAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "tokenAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LaunchSwept",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true,
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
  "name": "PoolGraduated",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "positionId",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "tokenAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "quoteAmount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "SnipeTaxSecondsUpdated",
  "inputs": [
   {
    "name": "secondsWindow",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "SnipeTaxStartBpsUpdated",
  "inputs": [
   {
    "name": "bps",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "TokenLaunched",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "curve",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "deployer",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "quoteToken",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   },
   {
    "name": "launchConfigId",
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
  "name": "WhitelistedLauncherUpdated",
  "inputs": [
   {
    "name": "launcher",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "enabled",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AlreadySet",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CombinedFeeTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CoreLpFeeMustBeZero",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CreatorFeeTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveFeeTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CurveNotQuotable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ExemptionListTooLong",
  "inputs": []
 },
 {
  "type": "error",
  "name": "FeeTransferFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "GraduationRescueTooEarly",
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
  "name": "GraduationSeedNotViable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InexactTransfer",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "expected",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "received",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "InvalidBasisPoints",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidCashback",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidLaunchConfigId",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidSnipeTaxWindow",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTickSpacing",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidTokenParams",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchConfigDisabled",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchDependenciesNotWired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchEconomicsMismatch",
  "inputs": [
   {
    "name": "expected",
    "type": "bytes32",
    "internalType": "bytes32"
   },
   {
    "name": "actual",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ]
 },
 {
  "type": "error",
  "name": "LaunchFeeNotPaid",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotCreatorFeeRecipient",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotReadyToGraduate",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotWhitelisted",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingToGraduate",
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
  "name": "SqrtPriceOutOfBounds",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SupplyTooHigh",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SupplyTooLow",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TokenNotFound",
  "inputs": []
 },
 {
  "type": "error",
  "name": "UnsupportedPrice",
  "inputs": []
 },
 {
  "type": "error",
  "name": "WrongGraduationPhase",
  "inputs": []
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
