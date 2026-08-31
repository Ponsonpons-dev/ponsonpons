export const PopFeeEscrowAbi = [
 {
  "type": "function",
  "name": "balanceOfToken",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "token",
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
  "name": "claimToken",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "claimToken",
  "inputs": [
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "creditToken",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "token",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [
   {
    "name": "credited",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "Claimed",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
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
  "name": "Credited",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "token",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "funder",
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
  "type": "error",
  "name": "NothingToClaim",
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
  "name": "ZeroAddress",
  "inputs": []
 }
] as const;
