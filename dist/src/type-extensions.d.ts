import 'hardhat/types/runtime';
import 'hardhat/types/config';
import { Address, DeploymentsExtension } from '../types';
declare module 'hardhat/types/config' {
    interface HardhatUserConfig {
        namedAccounts?: {
            [name: string]: string | number | {
                [network: string]: null | number | string;
            };
        };
        external?: {
            deployments?: {
                [networkName: string]: string[];
            };
            contracts?: {
                artifacts: string;
                deploy?: string;
            }[];
        };
        etherscan?: {
            apiKey: string;
        };
    }
    interface HardhatConfig {
        namedAccounts: {
            [name: string]: string | number | {
                [network: string]: null | number | string;
            };
        };
        external?: {
            deployments?: {
                [networkName: string]: string[];
            };
            contracts?: {
                artifacts: string;
                deploy?: string;
            }[];
        };
        etherscan?: {
            apiKey: string;
        };
    }
    interface HardhatNetworkUserConfig {
        live?: boolean;
        saveDeployments?: boolean;
        tags?: string[];
        deploy?: string | string[];
    }
    interface HttpNetworkUserConfig {
        live?: boolean;
        saveDeployments?: boolean;
        tags?: string[];
        deploy?: string | string[];
    }
    interface ProjectPathsUserConfig {
        deploy?: string | string[];
        deployments?: string;
        imports?: string;
    }
    interface HardhatNetworkConfig {
        live: boolean;
        saveDeployments: boolean;
        tags: string[];
        deploy?: string[];
    }
    interface HttpNetworkConfig {
        live: boolean;
        saveDeployments: boolean;
        tags: string[];
        deploy?: string[];
    }
    interface ProjectPathsConfig {
        deploy: string[];
        deployments: string;
        imports: string;
    }
}
declare module 'hardhat/types/runtime' {
    interface HardhatRuntimeEnvironment {
        deployments: DeploymentsExtension;
        getNamedAccounts: () => Promise<{
            [name: string]: Address;
        }>;
        getUnnamedAccounts: () => Promise<string[]>;
        getChainId(): Promise<string>;
    }
    interface Network {
        live: boolean;
        saveDeployments: boolean;
        tags: Record<string, boolean>;
        deploy: string[];
    }
}
//# sourceMappingURL=type-extensions.d.ts.map