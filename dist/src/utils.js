"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recode = exports.mergeABIs = exports.traverse = exports.traverseMultipleDirectory = exports.processNamedAccounts = exports.addDeployments = exports.deleteDeployments = exports.loadAllDeployments = exports.getExtendedArtifactFromFolder = exports.getArtifactFromFolder = void 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const wallet_1 = require("@ethersproject/wallet");
const address_1 = require("@ethersproject/address");
const abi_1 = require("@ethersproject/abi");
const bignumber_1 = require("@ethersproject/bignumber");
const artifacts_1 = require("hardhat/internal/artifacts");
const murmur_128_1 = __importDefault(require("murmur-128"));
function getOldArtifactSync(name, folderPath) {
    const oldArtifactPath = path.join(folderPath, name + '.json');
    let artifact;
    if (fs.existsSync(oldArtifactPath)) {
        try {
            artifact = JSON.parse(fs.readFileSync(oldArtifactPath).toString());
        }
        catch (e) {
            console.error(e);
        }
    }
    return artifact;
}
async function getArtifactFromFolder(name, folderPath) {
    const artifacts = new artifacts_1.Artifacts(folderPath);
    let artifact = getOldArtifactSync(name, folderPath);
    if (!artifact) {
        try {
            artifact = artifacts.readArtifactSync(name);
        }
        catch (e) { }
    }
    return artifact;
}
exports.getArtifactFromFolder = getArtifactFromFolder;
// TODO
// const solcInputMetadataCache: Record<string,
// const buildInfoCache
// const hashCache: Record<string, string> = {};
async function getExtendedArtifactFromFolder(name, folderPath) {
    const artifacts = new artifacts_1.Artifacts(folderPath);
    let artifact = getOldArtifactSync(name, folderPath);
    if (!artifact && (await artifacts.artifactExists(name))) {
        const hardhatArtifact = await artifacts.readArtifact(name);
        // check if name is already a fullyQualifiedName
        let fullyQualifiedName = name;
        if (!fullyQualifiedName.includes(':')) {
            fullyQualifiedName = `${hardhatArtifact.sourceName}:${name}`;
        }
        const buildInfo = await artifacts.getBuildInfo(fullyQualifiedName);
        if (buildInfo) {
            const solcInput = JSON.stringify(buildInfo.input, null, '  ');
            const solcInputHash = Buffer.from(murmur_128_1.default(solcInput)).toString('hex');
            artifact = Object.assign(Object.assign(Object.assign({}, hardhatArtifact), buildInfo.output.contracts[hardhatArtifact.sourceName][name]), { solcInput,
                solcInputHash });
        }
    }
    return artifact;
}
exports.getExtendedArtifactFromFolder = getExtendedArtifactFromFolder;
function loadAllDeployments(hre, deploymentsPath, onlyABIAndAddress, externalDeployments) {
    const all = {}; // TODO any is chainConfig
    fs.readdirSync(deploymentsPath).forEach((fileName) => {
        const fPath = path.resolve(deploymentsPath, fileName);
        const stats = fs.statSync(fPath);
        let name = fileName;
        if (stats.isDirectory()) {
            let chainIdFound;
            const chainIdFilepath = path.join(fPath, '.chainId');
            if (fs.existsSync(chainIdFilepath)) {
                chainIdFound = fs.readFileSync(chainIdFilepath).toString().trim();
                name = fileName;
            }
            else {
                throw new Error(`with hardhat-deploy >= 0.6 you need to rename network folder without appended chainId
          You also need to create a '.chainId' file in the folder with the chainId`);
            }
            if (!all[chainIdFound]) {
                all[chainIdFound] = {};
            }
            const contracts = loadDeployments(deploymentsPath, fileName, onlyABIAndAddress);
            all[chainIdFound][name] = {
                name,
                chainId: chainIdFound,
                contracts,
            };
        }
    });
    if (externalDeployments) {
        for (const networkName of Object.keys(externalDeployments)) {
            for (const folderPath of externalDeployments[networkName]) {
                const networkConfig = hre.config.networks[networkName];
                if (networkConfig && networkConfig.chainId) {
                    const networkChainId = networkConfig.chainId.toString();
                    const contracts = loadDeployments(folderPath, '', onlyABIAndAddress, undefined, networkChainId);
                    all[networkChainId][networkName] = {
                        name: networkName,
                        chainId: networkChainId,
                        contracts,
                    };
                }
                else {
                    console.warn(`export-all limitation: attempting to load external deployments from ${folderPath} without chainId info. Please set the chainId in the network config for ${networkName}`);
                }
            }
        }
    }
    return all;
}
exports.loadAllDeployments = loadAllDeployments;
function deleteDeployments(deploymentsPath, subPath) {
    const deployPath = path.join(deploymentsPath, subPath);
    fs.removeSync(deployPath);
}
exports.deleteDeployments = deleteDeployments;
function loadDeployments(deploymentsPath, subPath, onlyABIAndAddress, expectedChainId, truffleChainId) {
    const deploymentsFound = {};
    const deployPath = path.join(deploymentsPath, subPath);
    let filesStats;
    try {
        filesStats = exports.traverse(deployPath, undefined, undefined, (name) => !name.startsWith('.') && name !== 'solcInputs');
    }
    catch (e) {
        // console.log('no folder at ' + deployPath);
        return {};
    }
    if (filesStats.length > 0) {
        if (expectedChainId) {
            const chainIdFilepath = path.join(deployPath, '.chainId');
            if (fs.existsSync(chainIdFilepath)) {
                const chainIdFound = fs.readFileSync(chainIdFilepath).toString().trim();
                if (expectedChainId !== chainIdFound) {
                    throw new Error(`Loading deployment in folder '${deployPath}' (with chainId: ${chainIdFound}) for a different chainId (${expectedChainId})`);
                }
            }
            else {
                throw new Error(`with hardhat-deploy >= 0.6 you are expected to create a '.chainId' file in the deployment folder`);
            }
        }
    }
    let fileNames = filesStats.map((a) => a.relativePath);
    fileNames = fileNames.sort((a, b) => {
        if (a < b) {
            return -1;
        }
        if (a > b) {
            return 1;
        }
        return 0;
    });
    for (const fileName of fileNames) {
        if (fileName.substr(fileName.length - 5) === '.json') {
            const deploymentFileName = path.join(deployPath, fileName);
            let deployment = JSON.parse(fs.readFileSync(deploymentFileName).toString());
            if (!deployment.address && deployment.networks) {
                if (truffleChainId && deployment.networks[truffleChainId]) {
                    // TRUFFLE support
                    const truffleDeployment = deployment; // TruffleDeployment;
                    deployment.address =
                        truffleDeployment.networks[truffleChainId].address;
                    deployment.transactionHash =
                        truffleDeployment.networks[truffleChainId].transactionHash;
                }
            }
            if (onlyABIAndAddress) {
                deployment = {
                    address: deployment.address,
                    abi: deployment.abi,
                    linkedData: deployment.linkedData,
                };
            }
            const name = fileName.slice(0, fileName.length - 5);
            // console.log('fetching ' + deploymentFileName + '  for ' + name);
            deploymentsFound[name] = deployment;
        }
    }
    return deploymentsFound;
}
function addDeployments(
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
db, deploymentsPath, subPath, expectedChainId, truffleChainId) {
    const contracts = loadDeployments(deploymentsPath, subPath, false, expectedChainId, truffleChainId);
    for (const key of Object.keys(contracts)) {
        db.deployments[key] = contracts[key];
        // TODO ABIS
        // db.abis[contracts[key].address] = mergeABI(
        //   db.abis[contracts[key].address],
        //   contracts[key].abi
        // );
    }
}
exports.addDeployments = addDeployments;
function transformNamedAccounts(configNamedAccounts, chainIdGiven, accounts, networkConfigName) {
    const addressesToProtocol = {};
    const unknownAccountsDict = {};
    const knownAccountsDict = {};
    for (const account of accounts) {
        knownAccountsDict[account.toLowerCase()] = true;
    }
    const namedAccounts = {};
    const usedAccounts = {};
    // TODO transform into checksum  address
    if (configNamedAccounts) {
        const accountNames = Object.keys(configNamedAccounts);
        // eslint-disable-next-line no-inner-declarations
        function parseSpec(spec) {
            let address;
            switch (typeof spec) {
                case 'string':
                    // eslint-disable-next-line no-case-declarations
                    const protocolSplit = spec.split('://');
                    if (protocolSplit.length > 1) {
                        if (protocolSplit[0].toLowerCase() === 'ledger') {
                            address = protocolSplit[1];
                            addressesToProtocol[address.toLowerCase()] = protocolSplit[0].toLowerCase();
                            // knownAccountsDict[address.toLowerCase()] = true; // TODO ? this would prevent auto impersonation in fork/test
                        }
                        else if (protocolSplit[0].toLowerCase() === 'privatekey') {
                            address = new wallet_1.Wallet(protocolSplit[1]).address;
                            addressesToProtocol[address.toLowerCase()] =
                                'privatekey://' + protocolSplit[1];
                        }
                        else {
                            throw new Error(`unsupported protocol ${protocolSplit[0]}:// for named accounts`);
                        }
                    }
                    else {
                        if (spec.slice(0, 2).toLowerCase() === '0x') {
                            if (!address_1.isAddress(spec)) {
                                throw new Error(`"${spec}" is not a valid address, if you used to put privateKey there, use the "privatekey://" prefix instead`);
                            }
                            address = spec;
                        }
                        else {
                            address = parseSpec(configNamedAccounts[spec]);
                        }
                    }
                    break;
                case 'number':
                    if (accounts) {
                        address = accounts[spec];
                    }
                    break;
                case 'undefined':
                    break;
                case 'object':
                    if (spec) {
                        if (spec.type === 'object') {
                            address = spec;
                        }
                        else {
                            const newSpec = chainConfig(spec, chainIdGiven, networkConfigName);
                            if (typeof newSpec !== 'undefined') {
                                address = parseSpec(newSpec);
                            }
                        }
                    }
                    break;
            }
            if (address) {
                if (typeof address === 'string') {
                    address = address_1.getAddress(address);
                }
            }
            return address;
        }
        for (const accountName of accountNames) {
            const spec = configNamedAccounts[accountName];
            const address = parseSpec(spec);
            if (address) {
                namedAccounts[accountName] = address;
                usedAccounts[address.toLowerCase()] = true;
                if (!knownAccountsDict[address.toLowerCase()]) {
                    unknownAccountsDict[address.toLowerCase()] = true;
                }
            }
        }
    }
    const unnamedAccounts = [];
    for (const address of accounts) {
        if (!usedAccounts[address.toLowerCase()]) {
            unnamedAccounts.push(address_1.getAddress(address));
        }
    }
    return {
        namedAccounts,
        unnamedAccounts,
        unknownAccounts: Object.keys(unknownAccountsDict).map(address_1.getAddress),
        addressesToProtocol,
    };
}
function chainConfig(object, chainIdGiven, networkConfigName) {
    // TODO utility function:
    let chainIdDecimal;
    if (typeof chainIdGiven === 'number') {
        chainIdDecimal = '' + chainIdGiven;
    }
    else {
        if (chainIdGiven.startsWith('0x')) {
            chainIdDecimal = '' + parseInt(chainIdGiven.slice(2), 16);
        }
        else {
            chainIdDecimal = chainIdGiven;
        }
    }
    if (typeof object[networkConfigName] !== 'undefined') {
        return object[networkConfigName];
    }
    else if (typeof object[chainIdGiven] !== 'undefined') {
        return object[chainIdGiven];
    }
    else if (typeof object[chainIdDecimal] !== 'undefined') {
        return object[chainIdDecimal];
    }
    else {
        return object.default;
    }
}
function processNamedAccounts(network, namedAccounts, accounts, chainIdGiven) {
    if (namedAccounts) {
        return transformNamedAccounts(namedAccounts, chainIdGiven, accounts, process.env.HARDHAT_DEPLOY_ACCOUNTS_NETWORK || network.name);
    }
    else {
        return {
            namedAccounts: {},
            unnamedAccounts: accounts,
            unknownAccounts: [],
            addressesToProtocol: {},
        };
    }
}
exports.processNamedAccounts = processNamedAccounts;
function traverseMultipleDirectory(dirs) {
    const filepaths = [];
    for (const dir of dirs) {
        let filesStats = exports.traverse(dir);
        filesStats = filesStats.filter((v) => !v.directory);
        for (const filestat of filesStats) {
            filepaths.push(path.join(dir, filestat.relativePath));
        }
    }
    return filepaths;
}
exports.traverseMultipleDirectory = traverseMultipleDirectory;
exports.traverse = function (dir, result = [], topDir, filter // TODO any is Stats
) {
    fs.readdirSync(dir).forEach((name) => {
        const fPath = path.resolve(dir, name);
        const stats = fs.statSync(fPath);
        if ((!filter && !name.startsWith('.')) || (filter && filter(name, stats))) {
            const fileStats = {
                name,
                path: fPath,
                relativePath: path.relative(topDir || dir, fPath),
                mtimeMs: stats.mtimeMs,
                directory: stats.isDirectory(),
            };
            if (fileStats.directory) {
                result.push(fileStats);
                return exports.traverse(fPath, result, topDir || dir, filter);
            }
            result.push(fileStats);
        }
    });
    return result;
};
function mergeABIs(abis, options) {
    if (abis.length === 0) {
        return [];
    }
    const result = JSON.parse(JSON.stringify(abis[0]));
    for (let i = 1; i < abis.length; i++) {
        const abi = abis[i];
        for (const fragment of abi) {
            const newEthersFragment = abi_1.Fragment.from(fragment);
            // TODO constructor special handling ?
            const foundSameSig = result.find((v) => {
                const existingEthersFragment = abi_1.Fragment.from(v);
                if (v.type !== fragment.type) {
                    return false;
                }
                if (!existingEthersFragment) {
                    return v.name === fragment.name; // TODO fallback and receive hanlding
                }
                if (existingEthersFragment.type === 'constructor' ||
                    newEthersFragment.type === 'constructor') {
                    return existingEthersFragment.name === newEthersFragment.name;
                }
                if (newEthersFragment.type === 'function') {
                    return (abi_1.Interface.getSighash(existingEthersFragment) ===
                        abi_1.Interface.getSighash(newEthersFragment));
                }
                else if (newEthersFragment.type === 'event') {
                    return existingEthersFragment.format() === newEthersFragment.format();
                }
                else {
                    return v.name === fragment.name; // TODO fallback and receive hanlding
                }
            });
            if (foundSameSig) {
                if (options.check &&
                    !(options.skipSupportsInterface &&
                        fragment.name === 'supportsInterface')) {
                    if (fragment.type === 'function') {
                        throw new Error(`function "${fragment.name}" will shadow "${foundSameSig.name}". Please update code to avoid conflict.`);
                    }
                }
            }
            else {
                result.push(fragment);
            }
        }
    }
    return result;
}
exports.mergeABIs = mergeABIs;
function recode(decoded) {
    return {
        from: decoded.from,
        gasPrice: bignumber_1.BigNumber.from(decoded.from),
        gasLimit: bignumber_1.BigNumber.from(decoded.gasLimit),
        to: decoded.to,
        value: bignumber_1.BigNumber.from(decoded.value),
        nonce: decoded.nonce,
        data: decoded.data,
        r: decoded.r,
        s: decoded.s,
        v: decoded.v,
        // creates: tx.creates, // TODO test
        chainId: decoded.chainId,
    };
}
exports.recode = recode;
//# sourceMappingURL=utils.js.map