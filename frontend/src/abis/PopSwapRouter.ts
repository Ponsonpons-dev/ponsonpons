export const PopSwapRouterAbi = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "factory_",
    "type": "address",
    "internalType": "contract PopLaunchFactory"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "receive",
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "buyWithEth",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "minTokensOut",
    "type": "uint256",
    "internalType": "uint256"
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
  "stateMutability": "payable"
 },
 {
  "type": "function",
  "name": "factory",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract PopLaunchFactory"
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
  "name": "sellForEth",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "tokenIn",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "minEthOut",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "deadline",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "ethOut",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "uniswapV3SwapCallback",
  "inputs": [
   {
    "name": "amount0Delta",
    "type": "int256",
    "internalType": "int256"
   },
   {
    "name": "amount1Delta",
    "type": "int256",
    "internalType": "int256"
   },
   {
    "name": "data",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "unlockCallback",
  "inputs": [
   {
    "name": "data",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "weth",
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
  "type": "error",
  "name": "DeadlineExpired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "EthTransferFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "LaunchNotTradeable",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotConversionPool",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotPoolManager",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ReentrancyGuardReentrantCall",
  "inputs": []
 },
 {
  "type": "error",
  "name": "SafeCastOverflowedUintToInt",
  "inputs": [
   {
    "name": "value",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
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
  "name": "ZeroAmount",
  "inputs": []
 }
] as const;
