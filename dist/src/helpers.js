"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForTx = exports.addHelpers = void 0;
const providers_1 = require("@ethersproject/providers");
const address_1 = require("@ethersproject/address");
const contracts_1 = require("@ethersproject/contracts");
const constants_1 = require("@ethersproject/constants");
const bignumber_1 = require("@ethersproject/bignumber");
const wallet_1 = require("@ethersproject/wallet");
const solidity_1 = require("@ethersproject/solidity");
const bytes_1 = require("@ethersproject/bytes");
const abi_1 = require("@ethersproject/abi");
const types_1 = require("../types");
const errors_1 = require("./errors");
const utils_1 = require("./utils");
const TransparentUpgradeableProxy_json_1 = __importDefault(require("../extendedArtifacts/TransparentUpgradeableProxy.json"));
const OptimizedTransparentUpgradeableProxy_json_1 = __importDefault(require("../extendedArtifacts/OptimizedTransparentUpgradeableProxy.json"));
const ProxyAdmin_json_1 = __importDefault(require("../extendedArtifacts/ProxyAdmin.json"));
const EIP173Proxy_json_1 = __importDefault(require("../extendedArtifacts/EIP173Proxy.json"));
const EIP173ProxyWithReceive_json_1 = __importDefault(require("../extendedArtifacts/EIP173ProxyWithReceive.json"));
const Diamond_json_1 = __importDefault(require("../extendedArtifacts/Diamond.json"));
const DiamondCutFacet_json_1 = __importDefault(require("../extendedArtifacts/DiamondCutFacet.json"));
const DiamondLoupeFacet_json_1 = __importDefault(require("../extendedArtifacts/DiamondLoupeFacet.json"));
const OwnershipFacet_json_1 = __importDefault(require("../extendedArtifacts/OwnershipFacet.json"));
const Diamantaire_json_1 = __importDefault(require("../extendedArtifacts/Diamantaire.json"));
let LedgerSigner; // TODO type
Diamond_json_1.default.abi = utils_1.mergeABIs([
    Diamond_json_1.default.abi,
    DiamondCutFacet_json_1.default.abi,
    DiamondLoupeFacet_json_1.default.abi,
    OwnershipFacet_json_1.default.abi,
], { check: false, skipSupportsInterface: false });
function fixProvider(providerGiven) {
    // alow it to be used by ethers without any change
    if (providerGiven.sendAsync === undefined) {
        providerGiven.sendAsync = (req, callback) => {
            providerGiven
                .send(req.method, req.params)
                .then((result) => callback(null, { result, id: req.id, jsonrpc: req.jsonrpc }))
                .catch((error) => callback(error, null));
        };
    }
    return providerGiven;
}
function findAll(toFind, array) {
    for (const f of toFind) {
        if (array.indexOf(f) === -1) {
            return false;
        }
    }
    return true;
}
function linkRawLibrary(bytecode, libraryName, libraryAddress) {
    const address = libraryAddress.replace('0x', '');
    let encodedLibraryName;
    if (libraryName.startsWith('$') && libraryName.endsWith('$')) {
        encodedLibraryName = libraryName.slice(1, libraryName.length - 1);
    }
    else {
        encodedLibraryName = solidity_1.keccak256(['string'], [libraryName]).slice(2, 36);
    }
    const pattern = new RegExp(`_+\\$${encodedLibraryName}\\$_+`, 'g');
    if (!pattern.exec(bytecode)) {
        throw new Error(`Can't link '${libraryName}' (${encodedLibraryName}) in \n----\n ${bytecode}\n----\n`);
    }
    return bytecode.replace(pattern, address);
}
function linkRawLibraries(bytecode, libraries) {
    for (const libName of Object.keys(libraries)) {
        const libAddress = libraries[libName];
        bytecode = linkRawLibrary(bytecode, libName, libAddress);
    }
    return bytecode;
}
function linkLibraries(artifact, libraries) {
    let bytecode = artifact.bytecode;
    if (libraries) {
        if (artifact.linkReferences) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for (const [fileName, fileReferences] of Object.entries(artifact.linkReferences)) {
                for (const [libName, fixups] of Object.entries(fileReferences)) {
                    const addr = libraries[libName];
                    if (addr === undefined) {
                        continue;
                    }
                    for (const fixup of fixups) {
                        bytecode =
                            bytecode.substr(0, 2 + fixup.start * 2) +
                                addr.substr(2) +
                                bytecode.substr(2 + (fixup.start + fixup.length) * 2);
                    }
                }
            }
        }
        else {
            bytecode = linkRawLibraries(bytecode, libraries);
        }
    }
    // TODO return libraries object with path name <filepath.sol>:<name> for names
    return bytecode;
}
function addHelpers(deploymentManager, partialExtension, network, getArtifact, saveDeployment, willSaveToDisk, onPendingTx, getGasPrice, log, print) {
    let provider;
    const availableAccounts = {};
    async function init() {
        if (!provider) {
            provider = new providers_1.Web3Provider(fixProvider(network.provider));
            try {
                const accounts = await provider.send('eth_accounts', []);
                for (const account of accounts) {
                    availableAccounts[account.toLowerCase()] = true;
                }
                for (const address of deploymentManager.impersonatedAccounts) {
                    availableAccounts[address.toLowerCase()] = true;
                }
            }
            catch (e) { }
        }
    }
    async function setupGasPrice(overrides) {
        if (!overrides.gasPrice) {
            overrides.gasPrice = await getGasPrice();
        }
    }
    async function overrideGasLimit(overrides, options, estimate) {
        const estimatedGasLimit = options.estimatedGasLimit
            ? bignumber_1.BigNumber.from(options.estimatedGasLimit).toNumber()
            : undefined;
        const estimateGasExtra = options.estimateGasExtra
            ? bignumber_1.BigNumber.from(options.estimateGasExtra).toNumber()
            : undefined;
        if (!overrides.gasLimit) {
            overrides.gasLimit = estimatedGasLimit;
            overrides.gasLimit = (await estimate(overrides)).toNumber();
            if (estimateGasExtra) {
                overrides.gasLimit = overrides.gasLimit + estimateGasExtra;
                if (estimatedGasLimit) {
                    overrides.gasLimit = Math.min(overrides.gasLimit, estimatedGasLimit);
                }
            }
        }
    }
    function getCreate2Address(create2DeployerAddress, salt, bytecode) {
        return address_1.getAddress('0x' +
            solidity_1.keccak256(['bytes'], [
                `0xff${create2DeployerAddress.slice(2)}${salt.slice(2)}${solidity_1.keccak256(['bytes'], [bytecode]).slice(2)}`,
            ]).slice(-40));
    }
    async function ensureCreate2DeployerReady(options) {
        const { address: from, ethersSigner, hardwareWallet } = getFrom(options.from);
        if (!ethersSigner) {
            throw new Error('no signer for ' + from);
        }
        const create2DeployerAddress = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
        const code = await provider.getCode(create2DeployerAddress);
        if (code === '0x') {
            const senderAddress = '0x3fab184622dc19b6109349b94811493bf2a45362';
            // TODO gasPrice override
            if (options.log || hardwareWallet) {
                print(`sending eth to create2 contract deployer address (${senderAddress})`);
                if (hardwareWallet) {
                    print(` (please confirm on your ${hardwareWallet})`);
                }
            }
            const ethTx = await ethersSigner.sendTransaction({
                to: senderAddress,
                value: bignumber_1.BigNumber.from('10000000000000000').toHexString(),
            });
            if (options.log || hardwareWallet) {
                log(` (tx: ${ethTx.hash})...`);
            }
            await ethTx.wait();
            // await provider.send("eth_sendTransaction", [{
            //   from
            // }]);
            if (options.log || hardwareWallet) {
                print(`deploying create2 deployer contract (at ${create2DeployerAddress}) using deterministic deployment (https://github.com/Arachnid/deterministic-deployment-proxy)`);
                if (hardwareWallet) {
                    print(` (please confirm on your ${hardwareWallet})`);
                }
            }
            const deployTx = await provider.sendTransaction('0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222');
            if (options.log || hardwareWallet) {
                log(` (tx: ${deployTx.hash})...`);
            }
            await deployTx.wait();
        }
        return create2DeployerAddress;
    }
    async function getArtifactFromOptions(name, options) {
        let artifact;
        let artifactName;
        if (options.contract) {
            if (typeof options.contract === 'string') {
                artifactName = options.contract;
                artifact = await getArtifact(artifactName);
            }
            else {
                artifact = options.contract; // TODO better handling
            }
        }
        else {
            artifactName = name;
            artifact = await getArtifact(artifactName);
        }
        return { artifact, artifactName };
    }
    async function getLinkedArtifact(name, options) {
        // TODO get linked artifact
        const { artifact, artifactName } = await getArtifactFromOptions(name, options);
        const byteCode = linkLibraries(artifact, options.libraries);
        return { artifact: Object.assign(Object.assign({}, artifact), { bytecode: byteCode }), artifactName };
    }
    async function _deploy(name, options) {
        const args = options.args ? [...options.args] : [];
        await init();
        const { address: from, ethersSigner, hardwareWallet } = getFrom(options.from);
        if (!ethersSigner) {
            throw new Error('no signer for ' + from);
        }
        const { artifact: linkedArtifact, artifactName } = await getLinkedArtifact(name, options);
        const overrides = {
            gasLimit: options.gasLimit,
            gasPrice: options.gasPrice,
            value: options.value,
            nonce: options.nonce,
        };
        const factory = new contracts_1.ContractFactory(linkedArtifact.abi, linkedArtifact.bytecode, ethersSigner);
        const numArguments = factory.interface.deploy.inputs.length;
        if (args.length !== numArguments) {
            throw new Error(`expected ${numArguments} constructor arguments, got ${args.length}`);
        }
        const unsignedTx = factory.getDeployTransaction(...args, overrides);
        let create2Address;
        if (options.deterministicDeployment) {
            if (typeof unsignedTx.data === 'string') {
                const create2DeployerAddress = await ensureCreate2DeployerReady(options);
                const create2Salt = typeof options.deterministicDeployment === 'string'
                    ? bytes_1.hexlify(bytes_1.zeroPad(options.deterministicDeployment, 32))
                    : '0x0000000000000000000000000000000000000000000000000000000000000000';
                create2Address = getCreate2Address(create2DeployerAddress, create2Salt, unsignedTx.data);
                unsignedTx.to = create2DeployerAddress;
                unsignedTx.data = create2Salt + unsignedTx.data.slice(2);
            }
            else {
                throw new Error('unsigned tx data as bytes not supported');
            }
        }
        await overrideGasLimit(unsignedTx, options, (newOverrides) => ethersSigner.estimateGas(newOverrides));
        await setupGasPrice(unsignedTx);
        if (options.log || hardwareWallet) {
            print(`deploying "${name}"`);
            if (hardwareWallet) {
                print(` (please confirm on your ${hardwareWallet})`);
            }
        }
        let tx = await ethersSigner.sendTransaction(unsignedTx);
        if (options.log || hardwareWallet) {
            print(` (tx: ${tx.hash})...`);
        }
        // await overrideGasLimit(overrides, options, newOverrides =>
        //   ethersSigner.estimateGas(newOverrides)
        // );
        // await setupGasPrice(overrides);
        // console.log({ args, overrides });
        // const ethersContract = await factory.deploy(...args, overrides);
        // let tx = ethersContract.deployTransaction;
        if (options.autoMine) {
            try {
                await provider.send('evm_mine', []);
            }
            catch (e) { }
        }
        let preDeployment = Object.assign(Object.assign({}, linkedArtifact), { transactionHash: tx.hash, args, linkedData: options.linkedData });
        if (artifactName && willSaveToDisk()) {
            const extendedArtifact = await partialExtension.getExtendedArtifact(artifactName);
            preDeployment = Object.assign(Object.assign({}, extendedArtifact), preDeployment);
        }
        tx = await onPendingTx(tx, name, preDeployment);
        const receipt = await tx.wait();
        const address = options.deterministicDeployment && create2Address
            ? create2Address
            : receipt.contractAddress;
        const deployment = Object.assign(Object.assign({}, preDeployment), { address,
            receipt, transactionHash: receipt.transactionHash, libraries: options.libraries });
        await saveDeployment(name, deployment);
        if (options.log || hardwareWallet) {
            print(`: deployed at ${deployment.address} with ${receipt === null || receipt === void 0 ? void 0 : receipt.gasUsed} gas\n`);
        }
        return Object.assign(Object.assign({}, deployment), { address, newlyDeployed: true });
    }
    async function deterministic(name, options) {
        options = Object.assign({}, options); // ensure no change
        // TODO refactor to share that code:
        const args = options.args ? [...options.args] : [];
        await init();
        const { address: from, ethersSigner } = getFrom(options.from);
        if (!ethersSigner) {
            throw new Error('no signer for ' + from);
        }
        const artifactInfo = await getArtifactFromOptions(name, options);
        const { artifact } = artifactInfo;
        const abi = artifact.abi;
        const byteCode = linkLibraries(artifact, options.libraries);
        const factory = new contracts_1.ContractFactory(abi, byteCode, ethersSigner);
        const numArguments = factory.interface.deploy.inputs.length;
        if (args.length !== numArguments) {
            throw new Error(`expected ${numArguments} constructor arguments, got ${args.length}`);
        }
        const overrides = {
            gasLimit: options.gasLimit,
            gasPrice: options.gasPrice,
            value: options.value,
            nonce: options.nonce,
        };
        const unsignedTx = factory.getDeployTransaction(...args, overrides);
        if (typeof unsignedTx.data !== 'string') {
            throw new Error('unsigned tx data as bytes not supported');
        }
        else {
            return {
                address: getCreate2Address('0x4e59b44847b379578588920ca78fbf26c0b4956c', options.salt
                    ? bytes_1.hexlify(bytes_1.zeroPad(options.salt, 32))
                    : '0x0000000000000000000000000000000000000000000000000000000000000000', unsignedTx.data),
                deploy: () => deploy(name, Object.assign(Object.assign({}, options), { deterministicDeployment: options.salt || true })),
            };
        }
    }
    function getDeployment(name) {
        return partialExtension.get(name);
    }
    function getDeploymentOrNUll(name) {
        return partialExtension.getOrNull(name);
    }
    async function fetchIfDifferent(name, options) {
        options = Object.assign({}, options); // ensure no change
        const argArray = options.args ? [...options.args] : [];
        await init();
        if (options.deterministicDeployment) {
            // TODO remove duplication:
            const { address: from, ethersSigner } = getFrom(options.from);
            if (!ethersSigner) {
                throw new Error('no signer for ' + from);
            }
            const artifactInfo = await getArtifactFromOptions(name, options);
            const { artifact } = artifactInfo;
            const abi = artifact.abi;
            const byteCode = linkLibraries(artifact, options.libraries);
            const factory = new contracts_1.ContractFactory(abi, byteCode, ethersSigner);
            const numArguments = factory.interface.deploy.inputs.length;
            if (argArray.length !== numArguments) {
                throw new Error(`expected ${numArguments} constructor arguments, got ${argArray.length}`);
            }
            const overrides = {
                gasLimit: options.gasLimit,
                gasPrice: options.gasPrice,
                value: options.value,
                nonce: options.nonce,
            };
            const unsignedTx = factory.getDeployTransaction(...argArray, overrides);
            if (typeof unsignedTx.data === 'string') {
                const create2Salt = typeof options.deterministicDeployment === 'string'
                    ? bytes_1.hexlify(bytes_1.zeroPad(options.deterministicDeployment, 32))
                    : '0x0000000000000000000000000000000000000000000000000000000000000000';
                const create2DeployerAddress = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
                const create2Address = getCreate2Address(create2DeployerAddress, create2Salt, unsignedTx.data);
                const code = await provider.getCode(create2Address);
                if (code === '0x') {
                    return { differences: true, address: undefined };
                }
                else {
                    return { differences: false, address: create2Address };
                }
            }
            else {
                throw new Error('unsigned tx data as bytes not supported');
            }
        }
        const fieldsToCompareArray = typeof options.fieldsToCompare === 'string'
            ? [options.fieldsToCompare]
            : options.fieldsToCompare || [];
        const deployment = await partialExtension.getOrNull(name);
        if (deployment) {
            if (options.skipIfAlreadyDeployed) {
                return { differences: false, address: undefined }; // TODO check receipt, see below
            }
            // TODO transactionReceipt + check for status
            let transaction;
            if (deployment.receipt) {
                transaction = await provider.getTransaction(deployment.receipt.transactionHash);
            }
            else if (deployment.transactionHash) {
                transaction = await provider.getTransaction(deployment.transactionHash);
            }
            if (transaction) {
                const { ethersSigner } = await getOptionalFrom(options.from);
                const { artifact } = await getArtifactFromOptions(name, options);
                const abi = artifact.abi;
                const byteCode = linkLibraries(artifact, options.libraries);
                const factory = new contracts_1.ContractFactory(abi, byteCode, ethersSigner);
                const compareOnData = fieldsToCompareArray.indexOf('data') !== -1;
                let data;
                if (compareOnData) {
                    const deployStruct = factory.getDeployTransaction(...argArray);
                    data = deployStruct.data;
                }
                const newTransaction = {
                    data: compareOnData ? data : undefined,
                    gasLimit: options.gasLimit,
                    gasPrice: options.gasPrice,
                    value: options.value,
                    from: options.from,
                };
                for (const field of fieldsToCompareArray) {
                    if (typeof newTransaction[field] === 'undefined') {
                        throw new Error('field ' +
                            field +
                            ' not specified in new transaction, cant compare');
                    }
                    if (transaction[field] !== newTransaction[field]) {
                        return { differences: true, address: deployment.address };
                    }
                }
                return { differences: false, address: deployment.address };
            }
        }
        return { differences: true, address: undefined };
    }
    async function _deployOne(name, options, failsOnExistingDeterminisitc) {
        const argsArray = options.args ? [...options.args] : [];
        options = Object.assign(Object.assign({}, options), { args: argsArray });
        if (options.fieldsToCompare === undefined) {
            options.fieldsToCompare = ['data'];
        }
        let result;
        if (options.fieldsToCompare) {
            const diffResult = await fetchIfDifferent(name, options);
            if (diffResult.differences) {
                result = await _deploy(name, options);
            }
            else {
                if (failsOnExistingDeterminisitc && options.deterministicDeployment) {
                    throw new Error(`already deployed on same deterministic address: ${diffResult.address}`);
                }
                const deployment = await getDeploymentOrNUll(name);
                if (deployment) {
                    if (options.deterministicDeployment &&
                        diffResult.address &&
                        diffResult.address.toLowerCase() !==
                            deployment.address.toLowerCase()) {
                        const { artifact: linkedArtifact, artifactName, } = await getLinkedArtifact(name, options);
                        // receipt missing
                        const newDeployment = Object.assign(Object.assign({}, linkedArtifact), { address: diffResult.address, linkedData: options.linkedData, libraries: options.libraries, args: argsArray });
                        await saveDeployment(name, newDeployment, artifactName);
                        result = Object.assign(Object.assign({}, newDeployment), { newlyDeployed: false });
                    }
                    else {
                        result = deployment;
                    }
                }
                else {
                    if (!diffResult.address) {
                        throw new Error('no differences found but no address, this should be impossible');
                    }
                    const { artifact: linkedArtifact, artifactName, } = await getLinkedArtifact(name, options);
                    // receipt missing
                    const newDeployment = Object.assign(Object.assign({}, linkedArtifact), { address: diffResult.address, linkedData: options.linkedData, libraries: options.libraries, args: argsArray });
                    await saveDeployment(name, newDeployment, artifactName);
                    result = Object.assign(Object.assign({}, newDeployment), { newlyDeployed: false });
                }
                log(`reusing "${name}" at ${result.address}`);
            }
        }
        else {
            result = await _deploy(name, options);
        }
        return result;
    }
    function _checkUpgradeIndex(oldDeployment, upgradeIndex) {
        if (typeof upgradeIndex === 'undefined') {
            return;
        }
        if (upgradeIndex === 0) {
            if (oldDeployment) {
                return Object.assign(Object.assign({}, oldDeployment), { newlyDeployed: false });
            }
        }
        else if (upgradeIndex === 1) {
            if (!oldDeployment) {
                throw new Error('upgradeIndex === 1 : expects Deployments to already exists');
            }
            if (oldDeployment.history && oldDeployment.history.length > 0) {
                return Object.assign(Object.assign({}, oldDeployment), { newlyDeployed: false });
            }
        }
        else {
            if (!oldDeployment) {
                throw new Error(`upgradeIndex === ${upgradeIndex} : expects Deployments to already exists`);
            }
            if (!oldDeployment.history) {
                throw new Error(`upgradeIndex > 1 : expects Deployments history to exists`);
            }
            else if (oldDeployment.history.length > upgradeIndex - 1) {
                return Object.assign(Object.assign({}, oldDeployment), { newlyDeployed: false });
            }
            else if (oldDeployment.history.length < upgradeIndex - 1) {
                throw new Error(`upgradeIndex === ${upgradeIndex} : expects Deployments history length to be at least ${upgradeIndex - 1}`);
            }
        }
    }
    // TODO rename
    async function _deployViaEIP173Proxy(name, options) {
        const oldDeployment = await getDeploymentOrNUll(name);
        let updateMethod;
        let upgradeIndex;
        let proxyContract = EIP173Proxy_json_1.default;
        let checkABIConflict = true;
        let viaAdminContract;
        if (typeof options.proxy === 'object') {
            upgradeIndex = options.proxy.upgradeIndex;
            updateMethod = options.proxy.methodName;
            if (options.proxy.proxyContract) {
                if (typeof options.proxy.proxyContract === 'string') {
                    try {
                        proxyContract = await partialExtension.getExtendedArtifact(options.proxy.proxyContract);
                    }
                    catch (e) { }
                    if (!proxyContract || proxyContract === EIP173Proxy_json_1.default) {
                        if (options.proxy.proxyContract === 'EIP173ProxyWithReceive') {
                            proxyContract = EIP173ProxyWithReceive_json_1.default;
                        }
                        else if (options.proxy.proxyContract === 'EIP173Proxy') {
                            proxyContract = EIP173Proxy_json_1.default;
                        }
                        else if (options.proxy.proxyContract === 'OpenZeppelinTransparentProxy') {
                            checkABIConflict = false;
                            proxyContract = TransparentUpgradeableProxy_json_1.default;
                            viaAdminContract = 'DefaultProxyAdmin';
                        }
                        else if (options.proxy.proxyContract === 'OptimizedTransparentProxy') {
                            checkABIConflict = false;
                            proxyContract = OptimizedTransparentUpgradeableProxy_json_1.default;
                            viaAdminContract = 'DefaultProxyAdmin';
                        }
                        else {
                            throw new Error(`no contract found for ${options.proxy.proxyContract}`);
                        }
                    }
                }
            }
            if (options.proxy.viaAdminContract) {
                viaAdminContract = options.proxy.viaAdminContract;
            }
        }
        else if (typeof options.proxy === 'string') {
            updateMethod = options.proxy;
        }
        const deployResult = _checkUpgradeIndex(oldDeployment, upgradeIndex);
        if (deployResult) {
            return deployResult;
        }
        const proxyName = name + '_Proxy';
        const { address: owner } = getProxyOwner(options);
        const { address: from } = getFrom(options.from);
        const argsArray = options.args ? [...options.args] : [];
        // --- Implementation Deployment ---
        const implementationName = name + '_Implementation';
        const implementationOptions = {
            contract: options.contract || name,
            from: options.from,
            autoMine: options.autoMine,
            estimateGasExtra: options.estimateGasExtra,
            estimatedGasLimit: options.estimatedGasLimit,
            gasPrice: options.gasPrice,
            log: options.log,
            deterministicDeployment: options.deterministicDeployment,
            libraries: options.libraries,
            fieldsToCompare: options.fieldsToCompare,
            linkedData: options.linkedData,
            args: options.args,
        };
        const { artifact } = await getArtifactFromOptions(implementationName, implementationOptions);
        const proxyContractConstructor = proxyContract.abi.find((v) => v.type === 'constructor');
        // ensure no clash
        const mergedABI = utils_1.mergeABIs([proxyContract.abi, artifact.abi], {
            check: checkABIConflict,
            skipSupportsInterface: true,
        }).filter((v) => v.type !== 'constructor');
        mergedABI.push(proxyContractConstructor); // use proxy constructor abi
        const constructor = artifact.abi.find((fragment) => fragment.type === 'constructor');
        if (!constructor || constructor.inputs.length !== argsArray.length) {
            delete implementationOptions.args;
            if (constructor && constructor.inputs.length > 0) {
                throw new Error(`Proxy based contract constructor can only have either zero argument or the exact same argument as the method used for postUpgrade actions ${updateMethod ? '(' + updateMethod + '}' : ''}.
Plus they are only used when the contract is meant to be used as standalone when development ends.
`);
            }
        }
        if (updateMethod) {
            const updateMethodFound = artifact.abi.find((fragment) => fragment.type === 'function' && fragment.name === updateMethod);
            if (!updateMethodFound) {
                throw new Error(`contract need to implement function ${updateMethod}`);
            }
        }
        let proxyAdminName;
        let proxyAdmin = owner;
        let currentProxyAdminOwner;
        let proxyAdminDeployed;
        if (viaAdminContract) {
            let proxyAdminArtifactNameOrContract;
            if (typeof viaAdminContract === 'string') {
                proxyAdminName = viaAdminContract;
                proxyAdminArtifactNameOrContract = viaAdminContract;
            }
            else {
                proxyAdminName = viaAdminContract.name;
                if (!viaAdminContract.artifact) {
                    proxyAdminDeployed = await partialExtension.get(proxyAdminName);
                }
                proxyAdminArtifactNameOrContract = viaAdminContract.artifact;
            }
            let proxyAdminContract;
            if (typeof proxyAdminArtifactNameOrContract === 'string') {
                try {
                    proxyAdminContract = await partialExtension.getExtendedArtifact(proxyAdminArtifactNameOrContract);
                }
                catch (e) { }
                if (!proxyAdminContract) {
                    if (viaAdminContract === 'DefaultProxyAdmin') {
                        proxyAdminContract = ProxyAdmin_json_1.default;
                    }
                    else {
                        throw new Error(`no contract found for ${proxyAdminArtifactNameOrContract}`);
                    }
                }
            }
            else {
                proxyAdminContract = proxyAdminArtifactNameOrContract;
            }
            if (!proxyAdminDeployed) {
                proxyAdminDeployed = await _deployOne(proxyAdminName, {
                    from: options.from,
                    autoMine: options.autoMine,
                    estimateGasExtra: options.estimateGasExtra,
                    estimatedGasLimit: options.estimatedGasLimit,
                    gasPrice: options.gasPrice,
                    log: options.log,
                    contract: proxyAdminContract,
                    skipIfAlreadyDeployed: true,
                    args: [owner],
                });
            }
            proxyAdmin = proxyAdminDeployed.address;
            currentProxyAdminOwner = (await read(proxyAdminName, 'owner'));
            if (currentProxyAdminOwner.toLowerCase() !== owner.toLowerCase()) {
                throw new Error(`To change owner/admin, you need to call transferOwnership on ${proxyAdminName}`);
            }
            if (currentProxyAdminOwner === constants_1.AddressZero) {
                throw new Error(`The Proxy Admin (${proxyAdminName}) belongs to no-one. The Proxy cannot be upgraded anymore`);
            }
        }
        const implementation = await _deployOne(implementationName, implementationOptions);
        if (!oldDeployment || implementation.newlyDeployed) {
            // console.log(`implementation deployed at ${implementation.address} for ${implementation.receipt.gasUsed}`);
            const implementationContract = new contracts_1.Contract(implementation.address, implementation.abi);
            let data = '0x';
            if (updateMethod) {
                if (!implementationContract[updateMethod]) {
                    throw new Error(`contract need to implement function ${updateMethod}`);
                }
                const txData = await implementationContract.populateTransaction[updateMethod](...argsArray);
                data = txData.data || '0x';
            }
            let proxy = await getDeploymentOrNUll(proxyName);
            if (!proxy) {
                const proxyOptions = Object.assign({}, options); // ensure no change
                delete proxyOptions.proxy;
                proxyOptions.contract = proxyContract;
                proxyOptions.args = [implementation.address, proxyAdmin, data];
                proxy = await _deployOne(proxyName, proxyOptions, true);
                // console.log(`proxy deployed at ${proxy.address} for ${proxy.receipt.gasUsed}`);
            }
            else {
                const ownerStorage = await provider.getStorageAt(proxy.address, '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103');
                const currentOwner = address_1.getAddress(bignumber_1.BigNumber.from(ownerStorage).toHexString());
                const oldProxy = proxy.abi.find((frag) => frag.name === 'changeImplementation');
                const changeImplementationMethod = oldProxy
                    ? 'changeImplementation'
                    : 'upgradeToAndCall';
                if (currentOwner.toLowerCase() !== proxyAdmin.toLowerCase()) {
                    throw new Error(`To change owner/admin, you need to call the proxy directly`);
                }
                if (currentOwner === constants_1.AddressZero) {
                    throw new Error('The Proxy belongs to no-one. It cannot be upgraded anymore');
                }
                if (proxyAdminName) {
                    if (oldProxy) {
                        throw new Error(`Old Proxy do not support Proxy Admin contracts`);
                    }
                    if (!currentProxyAdminOwner) {
                        throw new Error(`no currentProxyAdminOwner found in ProxyAdmin`);
                    }
                    if (currentProxyAdminOwner.toLowerCase() !== from.toLowerCase()) {
                        throw new Error(`from != Proxy Admin Contract's owner`);
                    }
                    let executeReceipt;
                    if (updateMethod) {
                        executeReceipt = await execute(proxyAdminName, Object.assign(Object.assign({}, options), { from: currentProxyAdminOwner }), 'upgradeAndCall', proxy.address, implementation.address, data);
                    }
                    else {
                        executeReceipt = await execute(proxyAdminName, Object.assign(Object.assign({}, options), { from: currentProxyAdminOwner }), 'upgrade', proxy.address, implementation.address);
                    }
                    if (!executeReceipt) {
                        throw new Error(`could not execute ${changeImplementationMethod}`);
                    }
                }
                else {
                    if (currentOwner.toLowerCase() !== from.toLowerCase()) {
                        throw new Error(`from != proxy's admin/owner`);
                    }
                    let executeReceipt;
                    if (changeImplementationMethod === 'upgradeToAndCall' &&
                        !updateMethod) {
                        executeReceipt = await execute(proxyName, Object.assign(Object.assign({}, options), { from: currentOwner }), 'upgradeTo', implementation.address);
                    }
                    else {
                        executeReceipt = await execute(proxyName, Object.assign(Object.assign({}, options), { from: currentOwner }), changeImplementationMethod, implementation.address, data);
                    }
                    if (!executeReceipt) {
                        throw new Error(`could not execute ${changeImplementationMethod}`);
                    }
                }
            }
            const proxiedDeployment = Object.assign(Object.assign({}, proxyContract), { receipt: proxy.receipt, address: proxy.address, linkedData: options.linkedData, abi: mergedABI, implementation: implementation.address, args: proxy.args, execute: updateMethod
                    ? {
                        methodName: updateMethod,
                        args: argsArray,
                    }
                    : undefined });
            if (oldDeployment) {
                proxiedDeployment.history = proxiedDeployment.history
                    ? proxiedDeployment.history.concat([oldDeployment])
                    : [oldDeployment];
            }
            await saveDeployment(name, proxiedDeployment);
            const deployment = await partialExtension.get(name);
            return Object.assign(Object.assign({}, deployment), { newlyDeployed: true });
        }
        else {
            if (oldDeployment.implementation !== implementation.address) {
                const proxiedDeployment = Object.assign(Object.assign({}, oldDeployment), { implementation: implementation.address, linkedData: options.linkedData, abi: mergedABI, execute: updateMethod
                        ? {
                            methodName: updateMethod,
                            args: argsArray,
                        }
                        : undefined });
                proxiedDeployment.history = proxiedDeployment.history
                    ? proxiedDeployment.history.concat([oldDeployment])
                    : [oldDeployment];
                await saveDeployment(name, proxiedDeployment);
            }
            const deployment = await partialExtension.get(name);
            return Object.assign(Object.assign({}, deployment), { newlyDeployed: false });
        }
    }
    function getProxyOwner(options) {
        let address = options.from; // admim default to msg.sender
        if (typeof options.proxy === 'object') {
            address = options.proxy.owner || address;
        }
        return getFrom(address);
    }
    function getDiamondOwner(options) {
        let address = options.from; // admim default to msg.sender
        address = options.owner || address;
        return getFrom(address);
    }
    function getOptionalFrom(from) {
        return _getFrom(from, true);
    }
    function getFrom(from) {
        return _getFrom(from, false);
    }
    function _getFrom(from, optional) {
        let ethersSigner;
        let hardwareWallet = undefined;
        if (!from) {
            if (optional) {
                return {};
            }
            throw new Error('no from specified');
        }
        if (from.length >= 64) {
            if (from.length === 64) {
                from = '0x' + from;
            }
            const wallet = new wallet_1.Wallet(from, provider);
            from = wallet.address;
            ethersSigner = wallet;
        }
        else {
            if (availableAccounts[from.toLowerCase()]) {
                ethersSigner = provider.getSigner(from);
            }
            else {
                // TODO register protocol based account as availableAccounts ? if so do not else here
                const registeredProtocol = deploymentManager.addressesToProtocol[from.toLowerCase()];
                if (registeredProtocol) {
                    if (registeredProtocol === 'ledger') {
                        if (!LedgerSigner) {
                            // eslint-disable-next-line @typescript-eslint/no-var-requires
                            const hardwareWalletModule = require('@ethersproject/hardware-wallets');
                            LedgerSigner = hardwareWalletModule.LedgerSigner;
                        }
                        ethersSigner = new LedgerSigner(provider);
                    }
                    else if (registeredProtocol.startsWith('privatekey')) {
                        ethersSigner = new wallet_1.Wallet(registeredProtocol.substr(13), provider);
                    }
                }
                hardwareWallet = 'ledger';
            }
        }
        return { address: from, ethersSigner, hardwareWallet };
    }
    // async function findEvents(contract: Contract, event: string, blockHash: string): Promise<any[]> {
    //   // TODO type the return type
    //   const filter = contract.filters[event]();
    //   const events = await contract.queryFilter(filter, blockHash);
    //   return events;
    // }
    function sigsFromABI(abi) {
        return abi
            .filter((fragment) => fragment.type === 'function')
            .map((fragment) => abi_1.Interface.getSighash(abi_1.FunctionFragment.from(fragment)));
    }
    async function _deployViaDiamondProxy(name, options) {
        const oldDeployment = await getDeploymentOrNUll(name);
        let proxy;
        const deployResult = _checkUpgradeIndex(oldDeployment, options.upgradeIndex);
        if (deployResult) {
            return deployResult;
        }
        if (options.deterministicSalt) {
            throw new Error(`diamond determinsitc deployment not implemented yet`);
            // need to compute the resulting address accurately
        }
        const proxyName = name + '_DiamondProxy';
        const { address: owner, hardwareWallet } = getDiamondOwner(options);
        const newSelectors = [];
        const facetSnapshot = [];
        const oldFacets = [];
        const selectorToNotTouch = {};
        for (const selector of [
            '0xcdffacc6',
            '0x52ef6b2c',
            '0xadfca15e',
            '0x7a0ed627',
            '0x01ffc9a7',
            '0x1f931c1c',
            '0xf2fde38b',
            '0x8da5cb5b',
        ]) {
            selectorToNotTouch[selector] = true;
        }
        if (oldDeployment) {
            proxy = await getDeployment(proxyName);
            const diamondProxy = new contracts_1.Contract(proxy.address, proxy.abi, provider);
            const currentFacets = await diamondProxy.facets();
            for (const currentFacet of currentFacets) {
                oldFacets.push(currentFacet);
                // ensure DiamondLoupeFacet, OwnershipFacet and DiamondCutFacet are kept // TODO options to delete cut them out?
                if (findAll([
                    '0xcdffacc6',
                    '0x52ef6b2c',
                    '0xadfca15e',
                    '0x7a0ed627',
                    '0x01ffc9a7',
                ], currentFacet.functionSelectors) || // Loupe
                    currentFacet.functionSelectors[0] === '0x1f931c1c' || // DiamoncCut
                    findAll(['0xf2fde38b', '0x8da5cb5b'], currentFacet.functionSelectors) // ERC173
                ) {
                    facetSnapshot.push(currentFacet);
                    newSelectors.push(...currentFacet.functionSelectors);
                }
            }
        }
        // console.log({ oldFacets: JSON.stringify(oldFacets, null, "  ") });
        let changesDetected = !oldDeployment;
        let abi = Diamond_json_1.default.abi.concat([]);
        const facetCuts = [];
        for (const facet of options.facets) {
            const artifact = await getArtifact(facet); // TODO getArtifactFromOptions( // allowing to pass bytecode / abi
            const constructor = artifact.abi.find((fragment) => fragment.type === 'constructor');
            if (constructor) {
                throw new Error(`Facet with constructor not yet supported`); // TODO remove that requirement
            }
            abi = utils_1.mergeABIs([abi, artifact.abi], {
                check: true,
                skipSupportsInterface: false,
            });
            // TODO allow facet to be named so multiple version could coexist
            const implementation = await _deployOne(facet, {
                from: options.from,
                autoMine: options.autoMine,
                estimateGasExtra: options.estimateGasExtra,
                estimatedGasLimit: options.estimatedGasLimit,
                gasPrice: options.gasPrice,
                log: options.log,
                // deterministicDeployment: options.deterministicDeployment, // todo ?
                libraries: options.libraries,
                // fieldsToCompare: options.fieldsToCompare, // todo ?
                linkedData: options.linkedData,
            });
            if (implementation.newlyDeployed) {
                // console.log(`facet ${facet} deployed at ${implementation.address}`);
                const newFacet = {
                    facetAddress: implementation.address,
                    functionSelectors: sigsFromABI(implementation.abi),
                };
                facetSnapshot.push(newFacet);
                newSelectors.push(...newFacet.functionSelectors);
            }
            else {
                const oldImpl = await getDeployment(facet);
                const newFacet = {
                    facetAddress: oldImpl.address,
                    functionSelectors: sigsFromABI(oldImpl.abi),
                };
                facetSnapshot.push(newFacet);
                newSelectors.push(...newFacet.functionSelectors);
            }
        }
        const oldSelectors = [];
        const oldSelectorsFacetAddress = {};
        for (const oldFacet of oldFacets) {
            for (const selector of oldFacet.functionSelectors) {
                oldSelectors.push(selector);
                oldSelectorsFacetAddress[selector] = oldFacet.facetAddress;
            }
        }
        for (const newFacet of facetSnapshot) {
            const selectorsToAdd = [];
            const selectorsToReplace = [];
            for (const selector of newFacet.functionSelectors) {
                if (oldSelectors.indexOf(selector) > 0) {
                    if (oldSelectorsFacetAddress[selector].toLowerCase() !==
                        newFacet.facetAddress.toLowerCase() &&
                        !selectorToNotTouch[selector]) {
                        selectorsToReplace.push(selector);
                    }
                }
                else {
                    if (!selectorToNotTouch[selector]) {
                        selectorsToAdd.push(selector);
                    }
                }
            }
            if (selectorsToReplace.length > 0) {
                changesDetected = true;
                facetCuts.push({
                    facetAddress: newFacet.facetAddress,
                    functionSelectors: selectorsToReplace,
                    action: types_1.FacetCutAction.Replace,
                });
            }
            if (selectorsToAdd.length > 0) {
                changesDetected = true;
                facetCuts.push({
                    facetAddress: newFacet.facetAddress,
                    functionSelectors: selectorsToAdd,
                    action: types_1.FacetCutAction.Add,
                });
            }
        }
        const selectorsToDelete = [];
        for (const selector of oldSelectors) {
            if (newSelectors.indexOf(selector) === -1) {
                selectorsToDelete.push(selector);
            }
        }
        if (selectorsToDelete.length > 0) {
            changesDetected = true;
            facetCuts.unshift({
                facetAddress: '0x0000000000000000000000000000000000000000',
                functionSelectors: selectorsToDelete,
                action: types_1.FacetCutAction.Remove,
            });
        }
        let data = '0x';
        if (options.execute) {
            const diamondContract = new contracts_1.Contract('0x0000000000000000000000000000000000000001', abi);
            const txData = await diamondContract.populateTransaction[options.execute.methodName](...options.execute.args);
            data = txData.data || '0x';
        }
        if (changesDetected) {
            if (!proxy) {
                // ensure a Diamantaire exists on the network :
                const diamantaireName = 'Diamantaire';
                let diamantaireDeployment = await getDeploymentOrNUll(diamantaireName);
                diamantaireDeployment = await _deployOne(diamantaireName, {
                    contract: Diamantaire_json_1.default,
                    from: options.from,
                    deterministicDeployment: true,
                    autoMine: options.autoMine,
                    estimateGasExtra: options.estimateGasExtra,
                    estimatedGasLimit: options.estimatedGasLimit,
                    gasPrice: options.gasPrice,
                    log: options.log,
                });
                const diamantaireContract = new contracts_1.Contract(diamantaireDeployment.address, Diamantaire_json_1.default.abi, provider);
                // the diamantaire allow the execution of data at diamond construction time
                let deterministicDiamondAlreadyDeployed = false;
                let expectedAddress = undefined;
                let salt = '0x0000000000000000000000000000000000000000000000000000000000000000';
                if (typeof options.deterministicSalt !== 'undefined') {
                    if (typeof options.deterministicSalt === 'string') {
                        if (options.deterministicSalt === salt) {
                            throw new Error(`deterministicSalt cannot be 0x000..., it needs to be a non-zero bytes32 salt. This is to ensure you are explicitly specyfying different addresses for multiple diamonds`);
                        }
                        else {
                            if (options.deterministicSalt.length !== 66) {
                                throw new Error(`deterministicSalt needs to be a string of 66 hexadecimal characters (including the 0x prefix)`);
                            }
                            salt = options.deterministicSalt;
                            expectedAddress = getCreate2Address(diamantaireContract.address, solidity_1.keccak256(['bytes32', 'address'], [salt, owner]), Diamond_json_1.default.bytecode +
                                '000000000000000000000000' +
                                diamantaireContract.address.slice(2));
                            const code = await provider.getCode(expectedAddress);
                            if (code !== '0x') {
                                deterministicDiamondAlreadyDeployed = true;
                            }
                        }
                    }
                    else {
                        throw new Error(`deterministicSalt need to be a string, an non-zero bytes32 salt`);
                    }
                }
                if (expectedAddress && deterministicDiamondAlreadyDeployed) {
                    proxy = Object.assign(Object.assign({}, Diamond_json_1.default), { address: expectedAddress, args: [diamantaireDeployment.address] });
                    await saveDeployment(proxyName, proxy);
                }
                else {
                    const createReceipt = await execute(diamantaireName, options, 'createDiamond', owner, facetCuts, data, salt);
                    if (!createReceipt) {
                        throw new Error(`failed to get receipt from diamond creation`);
                    }
                    const events = [];
                    if (createReceipt.logs) {
                        for (const l of createReceipt.logs) {
                            try {
                                events.push(diamantaireContract.interface.parseLog(l));
                            }
                            catch (e) { }
                        }
                    }
                    const diamondCreatedEvent = events.find((e) => e.name === 'DiamondCreated');
                    if (!diamondCreatedEvent) {
                        throw new Error('DiamondCreated Not Emitted');
                    }
                    const proxyAddress = diamondCreatedEvent.args.diamond;
                    if (options.log || hardwareWallet) {
                        log(`Diamond deployed at ${proxyAddress} via Diamantaire (${diamantaireDeployment.address} (tx: ${createReceipt.transactionHash})) with ${createReceipt.gasUsed} gas`);
                    }
                    if (expectedAddress && expectedAddress !== proxyAddress) {
                        throw new Error(`unexpected address ${proxyAddress} VS ${expectedAddress}`);
                    }
                    proxy = Object.assign(Object.assign({}, Diamond_json_1.default), { address: proxyAddress, receipt: createReceipt, transactionHash: createReceipt.transactionHash, args: [diamantaireDeployment.address] });
                    await saveDeployment(proxyName, proxy);
                }
                await saveDeployment(name, Object.assign(Object.assign({}, Diamond_json_1.default), { args: proxy.args, address: proxy.address, receipt: proxy.receipt, transactionHash: proxy.transactionHash, linkedData: options.linkedData, facets: facetSnapshot, diamondCut: facetCuts, abi, execute: options.execute }));
            }
            else {
                if (!oldDeployment) {
                    throw new Error(`Cannot find Deployment for ${name}`);
                }
                const currentOwner = await read(proxyName, 'owner');
                if (currentOwner.toLowerCase() !== owner.toLowerCase()) {
                    throw new Error('To change owner, you need to call `transferOwnership`');
                }
                if (currentOwner === constants_1.AddressZero) {
                    throw new Error('The Diamond belongs to no-one. It cannot be upgraded anymore');
                }
                const executeReceipt = await execute(name, Object.assign(Object.assign({}, options), { from: currentOwner }), 'diamondCut', facetCuts, data === '0x'
                    ? '0x0000000000000000000000000000000000000000'
                    : proxy.address, data);
                if (!executeReceipt) {
                    throw new Error('failed to execute');
                }
                await saveDeployment(name, {
                    receipt: executeReceipt,
                    transactionHash: executeReceipt.transactionHash,
                    history: oldDeployment.history
                        ? oldDeployment.history.concat(oldDeployment)
                        : [oldDeployment],
                    linkedData: options.linkedData,
                    address: proxy.address,
                    abi,
                    facets: facetSnapshot,
                    diamondCut: facetCuts,
                    execute: options.execute,
                });
            }
            const deployment = await partialExtension.get(name);
            return Object.assign(Object.assign({}, deployment), { newlyDeployed: true });
        }
        else {
            const oldDeployment = await partialExtension.get(name);
            const proxiedDeployment = Object.assign(Object.assign({}, oldDeployment), { facets: facetSnapshot, diamondCut: facetCuts, abi, execute: options.execute });
            // TODO ?
            // proxiedDeployment.history = proxiedDeployment.history
            //   ? proxiedDeployment.history.concat([oldDeployment])
            //   : [oldDeployment];
            await saveDeployment(name, proxiedDeployment);
            const deployment = await partialExtension.get(name);
            return Object.assign(Object.assign({}, deployment), { newlyDeployed: false });
        }
    }
    async function deploy(name, options) {
        options = Object.assign({}, options); // ensure no change
        await init();
        if (!options.proxy) {
            return _deployOne(name, options);
        }
        return _deployViaEIP173Proxy(name, options);
    }
    async function diamond(name, options) {
        options = Object.assign({}, options); // ensure no change
        await init();
        return _deployViaDiamondProxy(name, options);
    }
    async function rawTx(tx) {
        tx = Object.assign({}, tx);
        await init();
        const { address: from, ethersSigner, hardwareWallet } = getFrom(tx.from);
        if (!ethersSigner) {
            throw new errors_1.UnknownSignerError({
                from,
                to: tx.to,
                data: tx.data,
                value: tx.value,
            });
        }
        else {
            const transactionData = {
                to: tx.to,
                gasLimit: tx.gasLimit,
                gasPrice: tx.gasPrice ? bignumber_1.BigNumber.from(tx.gasPrice) : undefined,
                value: tx.value ? bignumber_1.BigNumber.from(tx.value) : undefined,
                nonce: tx.nonce,
                data: tx.data,
            };
            if (hardwareWallet) {
                log(` please confirm on your ${hardwareWallet}`);
            }
            let pendingTx = await ethersSigner.sendTransaction(transactionData);
            pendingTx = await onPendingTx(pendingTx);
            if (tx.autoMine) {
                try {
                    await provider.send('evm_mine', []);
                }
                catch (e) { }
            }
            return pendingTx.wait();
        }
    }
    async function catchUnknownSigner(action, options) {
        const outputLog = !options || options.log === undefined || options.log;
        try {
            if (action instanceof Promise) {
                await action;
            }
            else {
                await action();
            }
        }
        catch (e) {
            if (e instanceof errors_1.UnknownSignerError) {
                const { from, to, data, value, contract } = e.data;
                if (outputLog) {
                    console.log(`---------------------------------------------------------------------------------------`);
                    console.error('no signer for ' + from);
                    console.log(`Please execute the following:`);
                    console.log(`---------------------------------------------------------------------------------------`);
                    if (contract) {
                        console.log(`
from: ${from}
to: ${to} (${contract.name})${value
                            ? '\nvalue: ' +
                                (typeof value === 'string' ? value : value.toString())
                            : ''}
method: ${contract.method}
args:
  - ${contract.args.join('\n  - ')}

(raw data: ${data} )
`);
                    }
                    else {
                        console.log(`
from: ${from}
to: ${to}${value
                            ? '\nvalue: ' +
                                (typeof value === 'string' ? value : value.toString())
                            : ''}
data: ${data}
`);
                    }
                    console.log(`---------------------------------------------------------------------------------------`);
                }
                if (!value || typeof value === 'string') {
                    return { from, to, value, data };
                }
                return { from, to, value: value === null || value === void 0 ? void 0 : value.toString(), data };
            }
            else {
                throw e;
            }
        }
        return null;
    }
    async function execute(name, options, methodName, ...args) {
        options = Object.assign({}, options); // ensure no change
        await init();
        const { address: from, ethersSigner, hardwareWallet } = getFrom(options.from);
        let tx;
        const deployment = await partialExtension.get(name);
        const abi = deployment.abi;
        const overrides = {
            gasLimit: options.gasLimit,
            gasPrice: options.gasPrice ? bignumber_1.BigNumber.from(options.gasPrice) : undefined,
            value: options.value ? bignumber_1.BigNumber.from(options.value) : undefined,
            nonce: options.nonce,
        };
        const ethersContract = new contracts_1.Contract(deployment.address, abi, ethersSigner || provider);
        if (!ethersContract.functions[methodName]) {
            throw new Error(`No method named "${methodName}" on contract deployed as "${name}"`);
        }
        const numArguments = ethersContract.interface.getFunction(methodName).inputs
            .length;
        if (args.length !== numArguments) {
            throw new Error(`expected ${numArguments} arguments for method "${methodName}", got ${args.length}`);
        }
        if (options.log || hardwareWallet) {
            print(`executing ${name}.${methodName}`);
            if (hardwareWallet) {
                print(` (please confirm on your ${hardwareWallet})`);
            }
        }
        if (!ethersSigner) {
            const ethersArgs = args ? args.concat([overrides]) : [overrides];
            const { data } = await ethersContract.populateTransaction[methodName](...ethersArgs);
            throw new errors_1.UnknownSignerError({
                from,
                to: deployment.address,
                data,
                value: options.value,
                contract: {
                    name,
                    method: methodName,
                    args,
                },
            });
        }
        else {
            await overrideGasLimit(overrides, options, (newOverrides) => {
                const ethersArgsWithGasLimit = args
                    ? args.concat([newOverrides])
                    : [newOverrides];
                return ethersContract.estimateGas[methodName](...ethersArgsWithGasLimit);
            });
            await setupGasPrice(overrides);
            const ethersArgs = args ? args.concat([overrides]) : [overrides];
            tx = await ethersContract.functions[methodName](...ethersArgs);
        }
        tx = await onPendingTx(tx);
        if (options.log || hardwareWallet) {
            print(` (tx: ${tx.hash}) ...`);
        }
        if (options.autoMine) {
            try {
                await provider.send('evm_mine', []);
            }
            catch (e) { }
        }
        const receipt = await tx.wait();
        if (options.log || hardwareWallet) {
            print(`: performed with ${receipt.gasUsed} gas\n`);
        }
        return receipt;
    }
    // TODO ?
    // async function rawCall(to: string, data: string) {
    //   // TODO call it eth_call?
    //   await init();
    //   return provider.send("eth_call", [
    //     {
    //       to,
    //       data
    //     },
    //     "latest"
    //   ]); // TODO overrides
    // }
    async function read(name, options, methodName, ...args) {
        if (typeof options === 'string') {
            if (typeof methodName !== 'undefined') {
                args.unshift(methodName);
            }
            methodName = options;
            options = {};
        }
        options = Object.assign({}, options); // ensure no change
        await init();
        if (typeof args === 'undefined') {
            args = [];
        }
        let caller = provider;
        const { ethersSigner } = getOptionalFrom(options.from);
        if (ethersSigner) {
            caller = ethersSigner;
        }
        const deployment = await partialExtension.get(name);
        if (!deployment) {
            throw new Error(`no contract named "${name}"`);
        }
        const abi = deployment.abi;
        const overrides = {
            gasLimit: options.gasLimit,
            gasPrice: options.gasPrice ? bignumber_1.BigNumber.from(options.gasPrice) : undefined,
            value: options.value ? bignumber_1.BigNumber.from(options.value) : undefined,
            nonce: options.nonce,
        };
        const ethersContract = new contracts_1.Contract(deployment.address, abi, caller);
        // populate function
        // if (options.outputTx) {
        //   const method = ethersContract.populateTransaction[methodName];
        //   if (!method) {
        //     throw new Error(
        //       `no method named "${methodName}" on contract "${name}"`
        //     );
        //   }
        //   if (args.length > 0) {
        //     return method(...args, overrides);
        //   } else {
        //     return method(overrides);
        //   }
        // }
        const method = ethersContract.callStatic[methodName];
        if (!method) {
            throw new Error(`no method named "${methodName}" on contract "${name}"`);
        }
        if (args.length > 0) {
            return method(...args, overrides);
        }
        else {
            return method(overrides);
        }
    }
    const extension = Object.assign(Object.assign({}, partialExtension), { fetchIfDifferent,
        deploy, diamond: {
            deploy: diamond,
        }, catchUnknownSigner,
        execute,
        rawTx,
        read,
        deterministic });
    // ////////// Backward compatible for transition: //////////////////
    extension.call = (options, name, methodName, ...args) => {
        if (typeof options === 'string') {
            args = args || [];
            if (methodName !== undefined) {
                args.unshift(methodName);
            }
            methodName = name;
            name = options;
            options = {};
        }
        return read(name, options, methodName, ...args);
    };
    extension.sendTxAndWait = (options, name, methodName, ...args) => {
        return execute(name, options, methodName, ...args);
    };
    extension.deployIfDifferent = (fieldsToCompare, name, options, contractName, ...args) => {
        options.fieldsToCompare = fieldsToCompare;
        options.contract = contractName;
        options.args = args;
        return deploy(name, options);
    };
    // ////////////////////////////////////////////////////////////////////
    return extension;
}
exports.addHelpers = addHelpers;
function pause(duration) {
    return new Promise((res) => setTimeout(res, duration * 1000));
}
async function waitForTx(ethereum, txHash, isContract) {
    let receipt;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            receipt = await ethereum.send('eth_getTransactionReceipt', [txHash]);
        }
        catch (e) { }
        if (receipt && receipt.blockNumber) {
            if (isContract) {
                if (!receipt.contractAddress) {
                    throw new Error('contract not deployed');
                }
                else {
                    return receipt;
                }
            }
            else {
                return receipt;
            }
        }
        await pause(2);
    }
}
exports.waitForTx = waitForTx;
//# sourceMappingURL=helpers.js.map