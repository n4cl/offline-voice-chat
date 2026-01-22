package server

import "net"

// BoundaryPolicy は許可されたローカルIP範囲を定義する。
type BoundaryPolicy struct {
	AllowedRanges []string
	allowedNets   []*net.IPNet
}

// DefaultBoundaryPolicy はRFC1918+localhostの許可範囲を返す。
func DefaultBoundaryPolicy() BoundaryPolicy {
	policy := BoundaryPolicy{
		AllowedRanges: []string{
			"127.0.0.0/8",
			"10.0.0.0/8",
			"172.16.0.0/12",
			"192.168.0.0/16",
		},
	}
	for _, cidr := range policy.AllowedRanges {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		policy.allowedNets = append(policy.allowedNets, network)
	}
	return policy
}

// AllowsIP は指定IPが許可範囲内かを判定する。
func (p BoundaryPolicy) AllowsIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	for _, network := range p.allowedNets {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// ScopeForIP はIPに対応する境界スコープを返す。
func (p BoundaryPolicy) ScopeForIP(ip net.IP) string {
	if ip != nil && ip.IsLoopback() {
		return "localhost"
	}
	return "rfc1918"
}

func remoteIP(addr string) net.IP {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return net.ParseIP(host)
	}
	return net.ParseIP(addr)
}
