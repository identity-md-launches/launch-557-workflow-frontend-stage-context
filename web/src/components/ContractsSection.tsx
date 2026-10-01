import { SOURCE_REPOSITORY_URL } from '../config/links'
import { useDeployment } from '../hooks/deployment'
import { AddressLink } from './AddressLink'

/** Every configured address with an explorer link, plus the attested deployment identifiers. */
export function ContractsSection() {
  const deployment = useDeployment()
  const { manifest, network } = deployment
  return (
    <section className="card" aria-labelledby="contracts-title" id="contracts">
      <h2 id="contracts-title" className="card__title">
        Contracts and deployment
      </h2>
      <p className="card__lead">
        Addresses, chain and ABIs are loaded at runtime from <code>imd-deployment.json</code>, the same file the publisher checks
        against the attested handoff.
      </p>
      <table className="table">
        <caption className="sr-only">Deployed contracts</caption>
        <thead>
          <tr>
            <th scope="col">Contract</th>
            <th scope="col">Address</th>
            <th scope="col">ABI</th>
          </tr>
        </thead>
        <tbody>
          {deployment.contracts.map((contract) => (
            <tr key={contract.name}>
              <th scope="row">{contract.name}</th>
              <td data-label="Address">
                <AddressLink address={contract.address} />
              </td>
              <td data-label="ABI">
                <a href={`./${contract.abiPath}`} target="_blank" rel="noreferrer noopener" className="mono" title={`keccak ${contract.abiHash}`}>
                  {contract.abiPath}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="kv">
        <div>
          <dt>Chain</dt>
          <dd>
            {network?.name ?? 'Unknown'} (id {manifest.chainId}
            {network?.testnet ? ', testnet' : ''})
          </dd>
        </div>
        <div>
          <dt>Launch id</dt>
          <dd className="mono wrap">{manifest.launchId}</dd>
        </div>
        <div>
          <dt>Source commit</dt>
          <dd className="mono wrap">
            {SOURCE_REPOSITORY_URL ? (
              <a href={`${SOURCE_REPOSITORY_URL}/tree/${manifest.sourceCommit}`} target="_blank" rel="noreferrer noopener">
                {manifest.sourceCommit}
              </a>
            ) : (
              manifest.sourceCommit
            )}
          </dd>
        </div>
        <div>
          <dt>Attestation hash</dt>
          <dd className="mono wrap">{manifest.attestationHash}</dd>
        </div>
        {network ? (
          <div>
            <dt>Read endpoints</dt>
            <dd>
              <ul className="plain-list">
                {network.rpcUrls.map((url) => (
                  <li key={url} className="mono wrap">
                    {url}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {network?.faucets?.length ? (
          <div>
            <dt>Test ETH</dt>
            <dd>
              <ul className="plain-list">
                {network.faucets.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer noopener" className="wrap">
                      {new URL(url).hostname} faucet
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      {network ? (
        <details className="disclosure">
          <summary>Uniswap v4 addresses on {network.name}</summary>
          <dl className="kv">
            {(
              [
                ['Pool manager', network.uniswapV4.poolManager],
                ['Universal Router', network.uniswapV4.universalRouter],
                ['Quoter', network.uniswapV4.quoter],
                ['State view', network.uniswapV4.stateView],
                ['Position manager', network.uniswapV4.positionManager],
                ['Permit2', network.uniswapV4.permit2],
              ] as const
            ).map(([label, address]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <AddressLink address={address} />
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  )
}
