import type { QueryClient } from '@tanstack/react-query';
import {
  showDeprecationWarning,
  ThirdwebAuthConfig,
  ThirdwebConfigProvider,
  ThirdwebSDKProvider,
  ThirdwebSDKProviderProps,
} from "@thirdweb-dev/react-core/evm";
import { Chain, defaultChains } from "@thirdweb-dev/chains";
import {
  DEFAULT_RPC_URLS,
  SDKOptions,
  getProviderForNetwork,
  SDKOptionsOutput,
  ChainId,
} from '@thirdweb-dev/sdk';
import type { ThirdwebStorage } from '@thirdweb-dev/storage';
import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  WagmiConfig,
  Connector,
  createClient,
} from 'wagmi';
import { WalletConnectConnector } from 'wagmi/connectors/walletConnect';
import { getDefaultProvider, providers, Signer } from 'ethers';
import invariant from 'tiny-invariant';
import { TW_WC_PROJECT_ID, WC_RELAY_URL } from '../constants/walletConnect';
import { transformChainToMinimalWagmiChain } from 'evm/utils/chains';

/**
 * @internal
 */
export type WalletConnectConnectorType =
  | WalletConnectConnector
  | 'walletConnect'
  | { name: 'walletConnect'; options: WalletConnectConnector['options'] };

/**
 * @internal
 */
export type WalletConnector = WalletConnectConnectorType;

interface IContext {
  isInitializing: boolean;
}

/**
 * Context
 */
export const SignerContext = createContext<IContext>({} as IContext);

/**
 * the metadata to pass to wallet connection dialog (may show up during the wallet-connection process)
 * @remarks this is only used for wallet connect and wallet link, metamask does not support it
 * @public
 */
export interface DAppMetaData {
  /**
   * the name of your app
   */
  name: string;
  /**
   * optional - a description of your app
   */
  description?: string;
  /**
   * optional - a url that points to a logo (or favicon) of your app
   */
  logoUrl?: string;
  /**
   * optional - the url where your app is hosted
   */
  url: string;
  /**
   * optional - whether to show the connect dialog in darkmode or not
   */
  isDarkMode?: boolean;
}

/**
 * The possible props for the ThirdwebProvider.
 */
export interface ThirdwebProviderProps<
  TChains extends Chain[] = typeof defaultChains
> {
/**
   * The network to use for the SDK.
   */
activeChain?: TChains[number]["chainId"] | TChains[number]["slug"] | Chain;
/**
 * Chains to support. If not provided, will default to the chains supported by the SDK.
 */
supportedChains?: Readonly<TChains>;

  /**
   * The {@link SDKOptions | Thirdweb SDK Options} to pass to the thirdweb SDK
   * comes with sensible defaults
   */
  sdkOptions?: SDKOptions;
  /**
   * An array of connector types (strings) or wallet connector objects that the dApp supports
   * If not provided, will default to metamask (injected), wallet connect and walletlink (coinbase wallet) with sensible defaults
   */
  walletConnectors?: WalletConnector[];
  /**
   * Metadata to pass to wallet connect and walletlink wallet connect. (Used to show *which* dApp is being connected to in mobile wallets that support it)
   * Defaults to just the name being passed as `thirdweb powered dApp`.
   */
  dAppMeta?: DAppMetaData;
   /**
   * The configuration used for thirdweb auth usage. Enables users to login
   * to backends with their wallet.
   */
  authConfig?: ThirdwebAuthConfig;
    /**
   * The storage interface to use with the sdk.
   */
  storageInterface?: ThirdwebStorage;
  /**
   * The react-query client to use. (Defaults to a default client.)
   */
  queryClient?: QueryClient;
  /**
   * The chainId that your dApp is running on.
   * @deprecated - use `network` instead
   */
  desiredChainId?: number | undefined;
  /**
   * A partial map of chainIds to rpc urls to use for certain chains
   * If not provided, will default to the rpcUrls of the chain objects for the supported chains
   * @deprecated - use `chains` instead
   */
  chainRpc?: Record<number, string>;
}

// SDK handles this under the hood for us

const defaultdAppMeta: DAppMetaData = {
  name: 'thirdweb powered dApp',
  url: 'https://thirdweb.com',
};

const defaultWalletConnectors: Required<
  ThirdwebProviderProps['walletConnectors']
> = ['walletConnect'];

/**
 *
 * The `<ThirdwebProvider />` component lets you control what networks you want users to connect to, what types of wallets can connect to your app, and the settings for the [Typescript SDK](https://docs.thirdweb.com/typescript).
 *
 * @example
 * You can wrap your application with the provider as follows:
 *
 * ```jsx title="App.jsx"
 * import { ThirdwebProvider, ChainId } from "@thirdweb-dev/react";
 *
 * const App = () => {
 *   return (
 *     <ThirdwebProvider desiredChainId={ChainId.Mainnet}>
 *       <YourApp />
 *     </ThirdwebProvider>
 *   );
 * };
 * ```
 *
 * @public
 *
 */
export const ThirdwebProvider = <
  TChains extends Chain[] = typeof defaultChains,
>({
  sdkOptions,

  // @ts-expect-error - different subtype of Chain[] but this works fine
  supportedChains = defaultChains,
  activeChain,

  walletConnectors = defaultWalletConnectors,
  dAppMeta = defaultdAppMeta,

  authConfig,
  storageInterface,
  queryClient,
  autoConnect = true,
  children,

  // deprecated
  desiredChainId,
  chainRpc,
}: React.PropsWithChildren<ThirdwebProviderProps<TChains>>) => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [signer, setSigner] = useState<Signer | undefined>()

  if (chainRpc) {
    showDeprecationWarning("chainRpc", "supportedChains");
  }
  if (desiredChainId) {
    showDeprecationWarning("desiredChainId", "activeChain");
  }

  const mergedChains = useMemo(() => {
    if (
      !activeChain ||
      typeof activeChain === "string" ||
      typeof activeChain === "number"
    ) {
      return supportedChains as Readonly<Chain[]>;
    }
    return [...supportedChains, activeChain] as Readonly<Chain[]>;
  }, [supportedChains, activeChain]);

  const activeChainId = useMemo(() => {
    if (!activeChain) {
      return undefined;
    }
    if (typeof activeChain === "string" || typeof activeChain === "number") {
      return activeChain;
    }
    return activeChain.chainId;
  }, [activeChain]);

  const wagmiClient = useMemo(() => {
    const wagmiChains = mergedChains.map(transformChainToMinimalWagmiChain);

    const _rpcUrlMap = {
      ...mergedChains.reduce((acc, c) => {
        acc[c.chainId] = c.rpc[0];
        return acc;
      }, {} as Record<number, string>),
    };
    
    const walletConnectClientMeta = {
      name: dAppMeta.name,
      url: dAppMeta.url,
      icons: [dAppMeta.logoUrl || ''],
      description: dAppMeta.description || '',
    };

    const wcConnector = walletConnectors[0];
    const projectId = typeof wcConnector === 'object' && 'projectId' in wcConnector.options ? wcConnector.options.projectId : TW_WC_PROJECT_ID
    const walletConnector = new WalletConnectConnector({
      chains: [
        {
          id: 1,
          name: 'Ethereum',
          network: 'homestead',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
          },
          rpcUrls: {
            default: {
              http: ['https://ethereum.rpc.thirdweb.com'],
            },
            public: {
              http: ['https://ethereum.rpc.thirdweb.com'],
            },
          },
        },
      ],
      options:  {
        metadata: walletConnectClientMeta,
        qrcode: false,
        version: '2',
        projectId: projectId,
        relayUrl: WC_RELAY_URL,
        logger: 'info',
      }
    });

    walletConnector.getProvider().then((provider) => {
      const web3Provider = new providers.Web3Provider(provider);
      setSigner(web3Provider.getSigner())
      setIsInitializing(false);
    });

    const client = createClient({
      connectors: () => {
        return walletConnectors
          .map((connector) => {
            if (connector instanceof Connector) {
              return connector;
            }
            // wallet connect
            if (
              (typeof connector === 'string' &&
                connector === 'walletConnect') ||
              (typeof connector === 'object' &&
                connector.name === 'walletConnect')
            ) {
              return walletConnector;
            }

            throw new Error(`Wallet connector not recognised: ${connector}`);
          })
          .filter((c) => c !== null);
      },
      provider: getDefaultProvider(),
    });

    return client;
  }, [dAppMeta.description, dAppMeta.logoUrl, dAppMeta.name, dAppMeta.url, mergedChains, walletConnectors]);

  const value = useMemo(() => ({
    isInitializing,
  }), [isInitializing])

  return (
    <SignerContext.Provider value={{...value}}>
      <ThirdwebConfigProvider
        value={{
          chains: supportedChains,
        }}
      >
        <WagmiConfig client={wagmiClient}>
          <ThirdwebSDKProviderWagmiWrapper
            queryClient={queryClient}
            sdkOptions={sdkOptions}
            supportedChains={supportedChains}
            // desiredChainId is deprecated, we will remove it in the future but still need to pass it here for now
            activeChain={activeChainId || desiredChainId}
            storageInterface={storageInterface}
            authConfig={authConfig}
          >
            {children}
          </ThirdwebSDKProviderWagmiWrapper>
        </WagmiConfig>
      </ThirdwebConfigProvider>
    </SignerContext.Provider>
  );
};

const ThirdwebSDKProviderWagmiWrapper = <TChains extends Chain[]>({
  children,
  ...props
}: React.PropsWithChildren<
  Omit<ThirdwebSDKProviderProps<TChains>, "signer" | "provider">
>) => {
  const { data } = useSigner();

  return (
    <ThirdwebSDKProvider signer={data} {...props}>
      {children}
    </ThirdwebSDKProvider>
  );
};

export function useThirdwebProvider() {
  const context = useContext(SignerContext);
  if (context === undefined) {
    throw new Error(
      'useThirdwebProvider must be used within a ThirdwebProvider',
    );
  }
  return context;
}
